require('dotenv').config();
const { Client, GatewayIntentBits, Collection, EmbedBuilder } = require('discord.js');
const fs = require('fs');

const { readSessions, removeExpiredSessions, getSessions, cancelSession, updateSession } = require('./utils/sessionStore');
const { getHistory, getHistoryCount } = require('./utils/sessionStore');
const { scheduleTimers, buildButtons }   = require('./commands/schedule');
const { applyEdit }                      = require('./commands/editschedule');
// Both history.js and sessions.js export a buildPaginationRow — aliased on
// import since both are needed in this one file and would otherwise collide.
const { buildHistoryEmbed, buildPaginationRow: historyPaginationRow } = require('./commands/history');
const { buildSessionsEmbed, buildPaginationRow: sessionsPaginationRow } = require('./commands/sessions');
const { cleanupLiveSession }             = require('./utils/cancelHelper');

// Initialise database on startup (runs CREATE TABLE and migrations)
require('./utils/db');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
  ]
});

client.commands    = new Collection();
// In-memory live session state (RSVP arrays, timer handles, the posted
// Message object) — separate from the DB rows in sessionStore, which are
// the source of truth that survives a restart. See the startup handler
// below for how these two are reconciled after a reboot.
client.rsvpSessions = {};
// Holds a member's pending /editschedule args between the initial command
// call and their selection on the edit_select menu, keyed by user id.
client.pendingEdits = {};

const commandFiles = fs.readdirSync('./commands').filter(f => f.endsWith('.js'));
for (const file of commandFiles) {
  const command = require(`./commands/${file}`);
  client.commands.set(command.data.name, command);
}

client.once('clientReady', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  // Sessions are kept as permanent history rather than deleted, so this is
  // currently a no-op — kept as a named step in case that policy changes.
  removeExpiredSessions();

  // Restore timers for all upcoming sessions across all guilds.
  // We read every session from the DB (no guildId filter) so that bots in
  // multiple servers all get their sessions restored on a single startup.
  const sessions = readSessions();
  const now      = Date.now();

  for (const session of sessions) {
    // Skip anything already cancelled or already in the past — a session
    // whose time has passed while the bot was offline has missed its
    // window entirely, so there's nothing to restore a timer for.
    if (session.cancelled || session.time <= now) continue;

    try {
      // Look up the guild by the stored guildId rather than using
      // guilds.cache.first(), which would only restore the first guild.
      const guild = client.guilds.cache.get(session.guildId);
      if (!guild) continue;

      const channel = await client.channels.fetch(session.channelId);
      const role    = guild.roles.cache.find(r => r.name.toLowerCase() === session.game.toLowerCase());
      // If either lookup fails (channel deleted, game role removed since
      // scheduling) there's nothing sensible to restore this session into.
      if (!channel || !role) continue;

      // Rebuild the in-memory live session from the DB row before wiring up
      // timers, since scheduleTimers' callbacks read rsvpSessions[id] at
      // fire time rather than being given the RSVP state directly.
      client.rsvpSessions[session.id] = {
        rsvpYes:      session.rsvpYes || [],
        rsvpNo:       session.rsvpNo  || [],
        message:      null,
        role,
        sessionTime:  session.time,
        extraMessage: session.extraMessage || '',
        cap:          session.cap ?? null,
        timers:       null,
      };

      // Pass all session metadata so recurring chains fire correctly after restart.
      const timers = scheduleTimers(
        client,
        session.id,
        session.time,
        role,
        channel,
        session.guildId,
        session.recurring,
        session.callerTag,
        session.cap ?? null,
        session.extraMessage || '',
      );
      client.rsvpSessions[session.id].timers = timers;

      console.log(`🔁 Restored timer for ${session.game} session at ${new Date(session.time).toLocaleString()}`);
    } catch (err) {
      // One session failing to restore (e.g. a fetch error) shouldn't stop
      // the rest of the loop from restoring everything else.
      console.error(`Failed to restore session ${session.id}:`, err.message);
    }
  }
});

client.on('error', error => console.error('Client error:', error));
process.on('unhandledRejection', error => console.error('Unhandled promise rejection:', error));

// Every interaction discord.js sends the bot funnels through here first,
// branching by interaction type/customId before falling through to the
// slash-command dispatch at the bottom. Each branch returns early so only
// one handler ever runs per interaction.
client.on('interactionCreate', async interaction => {

  // ── Autocomplete ─────────────────────────────────────────────────────────────
  if (interaction.isAutocomplete()) {
    const command = client.commands.get(interaction.commandName);
    if (command?.autocomplete) {
      try {
        await command.autocomplete(interaction);
      } catch (err) {
        // Autocomplete failures shouldn't crash the bot or block the command
        // itself — worst case the member just sees no suggestions.
        console.error('Autocomplete error:', err);
      }
    }
    return;
  }

  // ── Cancel select menu ────────────────────────────────────────────────────────
  // Shown by /cancelsession when a member has multiple upcoming sessions for
  // the same game and needs to pick which one to cancel.
  if (interaction.isStringSelectMenu() && interaction.customId === 'cancel_select') {
    const sessionId = interaction.values[0];
    const sessions  = getSessions(interaction.guildId);
    const session   = sessions.find(s => s.id === sessionId);

    if (!session) {
      return interaction.reply({ content: '❌ Session not found — it may have already been cancelled.', flags: 64 });
    }
    // Re-check ownership here too — the select menu itself doesn't enforce
    // it, and this interaction could in theory be triggered by someone
    // other than who ran the original /cancelsession command.
    if (session.callerTag !== interaction.user.tag) {
      return interaction.reply({ content: '❌ You can only cancel sessions you scheduled.', flags: 64 });
    }

    cancelSession(sessionId);
    // Same shared helper used by cancelsession.js's single-session path —
    // keeps both cancellation routes behaving identically.
    await cleanupLiveSession(interaction.client, sessionId);

    await interaction.update({
      content:    `✅ The **${session.game}** session scheduled for <t:${Math.floor(session.time / 1000)}:F> has been cancelled.`,
      components: []
    });
    return;
  }

  // ── Edit select menu ──────────────────────────────────────────────────────────
  // Shown by /editschedule when a member has multiple upcoming sessions for
  // the same game and needs to pick which one to apply the edit to.
  if (interaction.isStringSelectMenu() && interaction.customId === 'edit_select') {
    const sessionId  = interaction.values[0];
    const sessions   = getSessions(interaction.guildId);
    const session    = sessions.find(s => s.id === sessionId);

    if (!session) {
      return interaction.update({ content: '❌ Session not found — it may have already ended or been cancelled.', components: [] });
    }

    // The actual new time/cap/message values were captured back in
    // editschedule.js execute() and stashed here since a select menu
    // interaction has no direct way to carry the original command's options.
    const pendingEdit = interaction.client.pendingEdits?.[interaction.user.id];
    if (!pendingEdit) {
      return interaction.update({ content: '❌ Edit details expired — please run `/editschedule` again.', components: [] });
    }

    // Consume the pending edit immediately so a stale menu can't be reused
    // to reapply the same edit twice.
    delete interaction.client.pendingEdits[interaction.user.id];
    await interaction.update({ content: 'Applying edit...', components: [] });

    await applyEdit(interaction, session, pendingEdit.newTimeInput, pendingEdit.newCap, pendingEdit.newMessage, true);
    return;
  }

  // ── History pagination buttons ────────────────────────────────────────────────
  // customId format: history_{prev|next}_{currentPage}_{gameNameOrEmpty}
  if (interaction.isButton() && (interaction.customId.startsWith('history_prev_') || interaction.customId.startsWith('history_next_'))) {
    const parts     = interaction.customId.split('_');
    const direction = parts[1];
    const page      = parseInt(parts[2]);
    // Game names can themselves contain underscores, so everything after
    // the page number is rejoined rather than taken as a single part.
    const gameName  = parts.slice(3).join('_') || null;

    const newPage    = direction === 'next' ? page + 1 : page - 1;
    const guildId    = interaction.guildId;
    const total      = getHistoryCount(guildId, gameName);
    const totalPages = Math.max(1, Math.ceil(total / 10));
    const offset     = (newPage - 1) * 10;
    const sessions   = getHistory(guildId, gameName, 10, offset);

    const embed = buildHistoryEmbed(sessions, gameName, newPage, totalPages, total);
    const row   = historyPaginationRow(gameName, newPage, totalPages);

    await interaction.update({
      embeds:     [embed],
      components: row ? [row] : []
    });
    return;
  }

  // ── Sessions pagination buttons ───────────────────────────────────────────────
  // Same customId scheme as history pagination above, but for /sessions.
  // Kept separate rather than merged since the two commands pull from
  // different queries (getHistory vs getSessions) and build different embeds.
  if (interaction.isButton() && (interaction.customId.startsWith('sessions_prev_') || interaction.customId.startsWith('sessions_next_'))) {
    const parts     = interaction.customId.split('_');
    const direction = parts[1];
    const page      = parseInt(parts[2]);
    const gameName  = parts.slice(3).join('_') || null;

    const newPage = direction === 'next' ? page + 1 : page - 1;
    const guildId = interaction.guildId;

    // getSessions() only returns upcoming, non-cancelled sessions already —
    // no time/cancelled filtering needed here, just an optional game filter.
    let upcoming = getSessions(guildId);
    if (gameName) upcoming = upcoming.filter(s => s.game.toLowerCase() === gameName);

    const total      = upcoming.length;
    const totalPages = Math.max(1, Math.ceil(total / 10));
    const offset     = (newPage - 1) * 10;
    const pageItems  = upcoming.slice(offset, offset + 10);

    const embed = buildSessionsEmbed(pageItems, gameName, newPage, totalPages, total);
    const row   = sessionsPaginationRow(gameName, newPage, totalPages);

    await interaction.update({
      embeds:     [embed],
      components: row ? [row] : []
    });
    return;
  }

  // ── RSVP buttons ──────────────────────────────────────────────────────────────
  // The ✅/❌ buttons on a live session embed. Handled centrally here rather
  // than per-command since these buttons persist on a message long after the
  // originating /schedule command's interaction has ended.
  if (interaction.isButton()) {
    const customId = interaction.customId;
    const isYes    = customId.startsWith('rsvp_yes_');
    const isNo     = customId.startsWith('rsvp_no_');

    if (isYes || isNo) {
      const sessionId = customId.replace('rsvp_yes_', '').replace('rsvp_no_', '');
      // Looked up from the in-memory live session, not the DB — RSVP
      // clicks need to be fast and frequent, so this avoids a DB read on
      // every button press. The DB is still updated below to persist it.
      const session   = client.rsvpSessions[sessionId];

      if (!session) {
        return interaction.reply({ content: '❌ Session not found — it may have expired or been cancelled.', flags: 64 });
      }

      const userMention = interaction.user.toString();
      const alreadyYes  = session.rsvpYes.includes(userMention);

      // Block a new yes-RSVP when the cap is already full, but allow switching
      // from yes to no (alreadyYes check) which frees up a spot.
      if (isYes && !alreadyYes && session.cap !== null && session.rsvpYes.length >= session.cap) {
        return interaction.reply({ content: `❌ This session is full (${session.cap}/${session.cap}). You can't join the going list.`, flags: 64 });
      }

      // Remove the user from both lists then add them to the chosen one,
      // so switching RSVP is a single atomic update.
      session.rsvpYes = session.rsvpYes.filter(u => u !== userMention);
      session.rsvpNo  = session.rsvpNo.filter(u => u !== userMention);

      if (isYes) session.rsvpYes.push(userMention);
      else       session.rsvpNo.push(userMention);

      // Persist immediately rather than batching — an RSVP surviving a
      // crash matters more than the extra write per click.
      updateSession(sessionId, { rsvpYes: session.rsvpYes, rsvpNo: session.rsvpNo });

      const locked   = session.cap !== null && session.rsvpYes.length >= session.cap;
      const capLabel = session.cap !== null ? ` (${session.rsvpYes.length}/${session.cap})` : '';

      // Edit the existing embed's fields in place via spliceFields rather
      // than rebuilding it from buildEmbed — this handler doesn't have
      // easy access to all of buildEmbed's original inputs (e.g. the raw
      // extraMessage/recurring flag), and only the two RSVP fields change.
      const updated = EmbedBuilder.from(interaction.message.embeds[0])
        .spliceFields(2, 1, {
          name:   `✅ Going${capLabel}`,
          value:  session.rsvpYes.length > 0 ? session.rsvpYes.join('\n') : 'Nobody yet',
          inline: true
        })
        .spliceFields(3, 1, {
          name:   '❌ Not going',
          value:  session.rsvpNo.length > 0 ? session.rsvpNo.join('\n') : 'Nobody yet',
          inline: true
        });

      await interaction.update({
        embeds:     [updated],
        components: [buildButtons(sessionId, locked)]
      });
    }
    return;
  }

  // ── Slash commands ────────────────────────────────────────────────────────────
  // Falls through to here for anything not caught by the branches above.
  if (!interaction.isChatInputCommand()) return;
  console.log(`Command received: ${interaction.commandName}`);

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error('Command error:', error);
    // Only reply here if the command itself hasn't already responded —
    // otherwise this would throw a second "already replied" error on top
    // of whatever originally failed.
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'Something went wrong!', flags: 64 });
    }
  }
});

client.login(process.env.TOKEN);