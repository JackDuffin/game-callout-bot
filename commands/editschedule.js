const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { getSessions, updateSession, getTimezone } = require('../utils/sessionStore');
const { buildEmbed, buildButtons, parseSessionTime, scheduleTimers } = require('./schedule');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('editschedule')
    .setDescription('Edit a session you scheduled')
    .addStringOption(opt =>
      opt.setName('game')
        .setDescription('The game session to edit')
        .setRequired(true)
        .setAutocomplete(true))
    .addStringOption(opt =>
      opt.setName('time')
        .setDescription('New time e.g. 21:30 or 21:30 25/04/27')
        .setRequired(false))
    .addIntegerOption(opt =>
      opt.setName('cap')
        // 0 is treated as "remove the cap" rather than a real value below,
        // since a cap of 0 players wouldn't make sense — null (not supplied)
        // and 0 (explicitly cleared) need to be distinguishable, so the
        // option itself has no built-in "unset" sentinel of its own.
        .setDescription('New player cap (0 to remove the cap)')
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(99))
    .addStringOption(opt =>
      opt.setName('message')
        .setDescription('New message (use "none" to clear it)')
        .setRequired(false)),

  async autocomplete(interaction) {
    const focused  = interaction.options.getFocused().toLowerCase();
    const sessions = getSessions(interaction.guildId);

    // Only suggest games the member has an upcoming session for as the
    // scheduler — editing is restricted to whoever originally scheduled it,
    // so there's no point suggesting games they can't actually edit.
    const userGames = [...new Set(
      sessions
        .filter(s => s.callerTag === interaction.user.tag)
        .map(s => s.game)
    )];

    const filtered = userGames
      .filter(name => name.toLowerCase().includes(focused))
      .slice(0, 25);

    await interaction.respond(filtered.map(name => ({ name, value: name })));
  },

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });

    const input        = interaction.options.getString('game').toLowerCase();
    const newTimeInput = interaction.options.getString('time');
    const newMessage   = interaction.options.getString('message');
    // ?? null (not || null) matters here — getInteger returns 0 for an
    // explicit "remove cap" and 0 is falsy, so || would wrongly collapse it
    // to the same "unchanged" state as not supplying the option at all.
    const newCap       = interaction.options.getInteger('cap') ?? null;

    // At least one field has to actually change, otherwise this is a no-op
    // command call and the member probably meant to supply something.
    if (!newTimeInput && newMessage === null && newCap === null) {
      return interaction.editReply({ content: '❌ Please provide a new time, cap, message, or any combination of the three.' });
    }

    const sessions     = getSessions(interaction.guildId);
    // Editing is scoped to sessions this member scheduled — same rule as
    // cancellation, so one member can't tamper with another's session.
    const userSessions = sessions.filter(s =>
      s.game.toLowerCase() === input &&
      s.callerTag === interaction.user.tag
    );

    if (userSessions.length === 0) {
      // Distinguish "no session for this game at all" from "a session
      // exists but you're not the one who scheduled it" — the latter gives
      // a clearer error than a generic "not found".
      const allForGame = sessions.filter(s => s.game.toLowerCase() === input);
      if (allForGame.length > 0) {
        return interaction.editReply({ content: `❌ You didn't schedule any upcoming **${input}** sessions — only the person who scheduled it can edit it.` });
      }
      return interaction.editReply({ content: `❌ No upcoming session found for **${input}**.` });
    }

    if (userSessions.length === 1) {
      return applyEdit(interaction, userSessions[0], newTimeInput, newCap, newMessage, false);
    }

    // Multiple sessions — show select menu; stash pending edit args on the client
    // so the select handler in index.js can retrieve them.
    const options = userSessions
      .sort((a, b) => a.time - b.time)
      .map(s => ({
        label:       `${s.game} — ${new Date(s.time).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}`,
        description: new Date(s.time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }),
        value:       s.id
      }));

    if (!interaction.client.pendingEdits) interaction.client.pendingEdits = {};
    // Keyed by user id rather than session id — only one pending edit per
    // member makes sense at a time, and this is read back out (and deleted)
    // by the edit_select handler in index.js once they pick from the menu.
    interaction.client.pendingEdits[interaction.user.id] = { newTimeInput, newCap, newMessage };

    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('edit_select')
        .setPlaceholder('Pick the session to edit')
        .addOptions(options)
    );

    await interaction.editReply({
      content:    `You have **${userSessions.length}** upcoming ${input} sessions — which one do you want to edit?`,
      components: [row]
    });
  }
};

// Shared by both the direct single-session path above and the edit_select
// handler in index.js (hence fromSelect) — applies whichever of time/cap/
// message were actually supplied, updates the DB, and if the session is
// still live, reschedules its timers and edits its embed in place.
async function applyEdit(interaction, session, newTimeInput, newCap, newMessage, fromSelect = false) {
  const liveSession = interaction.client.rsvpSessions?.[session.id];

  let newSessionTime = null;
  if (newTimeInput) {
    const timezone = getTimezone(interaction.guildId, interaction.user.id);
    const parsed   = parseSessionTime(newTimeInput, timezone);
    if (parsed instanceof Error) {
      // fromSelect determines which Discord response method is valid here —
      // the original interaction was already replied to (the select menu
      // itself), so a second edit path needs followUp instead of editReply.
      const msg = { content: `❌ ${parsed.message}`, flags: 64 };
      return fromSelect ? interaction.followUp(msg) : interaction.editReply(msg);
    }
    if (parsed.getTime() - Date.now() < 5 * 60 * 1000) {
      const msg = { content: '❌ Please schedule sessions at least 5 minutes in the future.', flags: 64 };
      return fromSelect ? interaction.followUp(msg) : interaction.editReply(msg);
    }
    newSessionTime = parsed;
  }

  const updatedTime    = newSessionTime ? newSessionTime.getTime() : session.time;
  const updatedMessage = newMessage === 'none' ? '' : (newMessage ?? session.extraMessage ?? '');
  // newCap === 0 means clear it; newCap === null means unchanged.
  const updatedCap     = newCap === null ? (session.cap ?? null) : (newCap === 0 ? null : newCap);

  // Always write all three fields even if only one changed — updateSession
  // reads the existing row for anything not explicitly overridden, so this
  // keeps the DB and the computed "updated" values in sync in one call
  // rather than needing conditional partial updates.
  updateSession(session.id, {
    time:         updatedTime,
    extraMessage: updatedMessage,
    cap:          updatedCap,
  });

  // The DB write above happens regardless of whether the bot is still
  // running with a live in-memory session for it — but a running bot also
  // needs to fix up its live timers and the actual posted Discord message,
  // which only makes sense if liveSession still exists (e.g. not true right
  // after a crash, before restoration runs).
  if (liveSession) {
    if (newSessionTime) {
      liveSession.sessionTime = updatedTime;

      // Clear the old timers before scheduling new ones off the updated
      // time — otherwise both the stale and the new timer would be live
      // simultaneously, double-firing reminders/start pings.
      if (liveSession.timers) {
        clearTimeout(liveSession.timers.reminderTimer);
        clearTimeout(liveSession.timers.startTimer);
      }

      try {
        const channel = await interaction.client.channels.fetch(session.channelId);
        // Pass all session metadata (not just the first few positional args)
        // so recurring chains survive a time edit — a truncated call here
        // previously reset recurring/callerTag/cap/extraMessage to their
        // scheduleTimers() defaults, silently breaking the chain for any
        // session that got its time edited before it fired.
        liveSession.timers = scheduleTimers(
          interaction.client,
          session.id,
          updatedTime,
          liveSession.role,
          channel,
          interaction.guildId,
          session.recurring,
          session.callerTag,
          updatedCap,
          updatedMessage,
        );
      } catch (err) {
        console.error('Failed to reschedule timers:', err.message);
      }
    }

    // These two only need updating on the live object when actually
    // supplied — an untouched field shouldn't overwrite the live value with
    // something derived from a "no change" input.
    if (newMessage !== null) liveSession.extraMessage = updatedMessage;
    if (newCap !== null)     liveSession.cap = updatedCap;

    if (liveSession.message) {
      try {
        // The caller mention isn't stored anywhere else convenient, so it's
        // pulled back out of the existing embed rather than re-deriving it —
        // falls back to the editing user only in the unlikely case the
        // field is missing entirely.
        const callerMention = liveSession.message.embeds[0]?.fields?.find(f => f.name === '📣 Called by')?.value
          ?? interaction.user.toString();

        const updatedEmbed = buildEmbed(
          session.game,
          updatedTime,
          callerMention,
          updatedMessage,
          liveSession.rsvpYes,
          liveSession.rsvpNo,
          updatedCap
        );

        // Recompute the locked state in case a cap was just added or lowered
        // below the current RSVP count — the button state needs to reflect
        // the *new* cap immediately, not wait for the next RSVP click.
        const locked = updatedCap !== null && liveSession.rsvpYes.length >= updatedCap;
        await liveSession.message.edit({
          embeds:     [updatedEmbed],
          components: [buildButtons(session.id, locked)]
        });
      } catch (err) {
        console.error('Failed to edit session embed:', err.message);
      }
    }
  }

  // Only list the fields that were actually part of this edit, in the same
  // order as the command options, so the confirmation reads naturally
  // regardless of which subset the member supplied.
  const changes = [];
  if (newSessionTime) changes.push(`🕐 Time → <t:${Math.floor(updatedTime / 1000)}:F>`);
  if (newCap !== null) changes.push(`👥 Cap → ${updatedCap !== null ? updatedCap : '*(removed)*'}`);
  if (newMessage !== null) changes.push(`💬 Message → ${updatedMessage || '*(cleared)*'}`);

  const msg = { content: `✅ Session updated!\n${changes.join('\n')}`, flags: 64 };
  return fromSelect ? interaction.followUp(msg) : interaction.editReply(msg);
}

module.exports.applyEdit = applyEdit;