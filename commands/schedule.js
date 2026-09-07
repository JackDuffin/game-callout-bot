const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { addSession, getTimezone, getMutedUsers } = require('../utils/sessionStore');
const { v4: uuidv4 } = require('uuid');

// setTimeout's delay is capped at a 32-bit signed int (~24.8 days) — see the
// comment on safeTimeout below for why this matters.
const MAX_TIMEOUT = 2_147_483_647;
// Used to calculate the next occurrence's timestamp for recurring sessions.
const WEEK_MS     = 7 * 24 * 60 * 60 * 1000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('schedule')
    .setDescription('Schedule a game session')
    .addStringOption(opt =>
      opt.setName('game')
        .setDescription('Which game group to schedule for')
        .setRequired(true)
        .setAutocomplete(true))
    .addStringOption(opt =>
      opt.setName('time')
        .setDescription('e.g. 21:30 or 21:30 25/04 or 21:30 25/04/27 or 21:30 25/04/2027')
        .setRequired(true))
    .addIntegerOption(opt =>
      opt.setName('cap')
        // Optional rather than defaulting to a number — most games don't need
        // a hard player limit, so "unlimited" has to be a real, distinct state.
        .setDescription('Max number of players (leave blank for unlimited)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(99))
    .addBooleanOption(opt =>
      opt.setName('repeat')
        .setDescription('Repeat this session every week')
        .setRequired(false))
    .addStringOption(opt =>
      opt.setName('message')
        .setDescription('Optional extra message')
        .setRequired(false)),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const guild   = interaction.guild;
    // Only suggest games the member is actually in — scheduling for a game
    // group you haven't joined isn't allowed (enforced again below in
    // execute(), since autocomplete suggestions can be bypassed by typing
    // a value directly), so there's no point surfacing them here.
    const roles   = guild.roles.cache
      .filter(r => r.name !== '@everyone' && !r.managed && interaction.member.roles.cache.has(r.id))
      .map(r => r.name);

    const filtered = roles.filter(name => name.toLowerCase().includes(focused)).slice(0, 25);
    await interaction.respond(filtered.map(name => ({ name, value: name })));
  },

  async execute(interaction) {
    // Session creation involves several awaits (message send, fetchReply)
    // so this needs to be deferred to stay within Discord's response window.
    await interaction.deferReply();

    const gameName     = interaction.options.getString('game');
    const timeInput    = interaction.options.getString('time').trim();
    const cap          = interaction.options.getInteger('cap') ?? null;
    const recurring    = interaction.options.getBoolean('repeat') ?? false;
    const extraMessage = interaction.options.getString('message') || '';
    const guild        = interaction.guild;

    // @everyone and managed roles (e.g. bot-integration roles) are never
    // game groups, so they're excluded everywhere game roles are resolved.
    const gameRoles = guild.roles.cache.filter(r => r.name !== '@everyone' && !r.managed);
    // Accept either the display name (normal path, from autocomplete or free
    // typing) or a raw role id, in case a member pastes a role mention/id.
    const role      = gameRoles.find(r => r.name.toLowerCase() === gameName.toLowerCase() || r.id === gameName);

    if (!role) {
      const list = gameRoles.map(r => `• ${r.name}`).join('\n');
      return interaction.editReply({ content: `❌ No game group called **${gameName}**. Available groups:\n${list}` });
    }

    // Re-check membership server-side even though autocomplete already
    // filters to joined games — autocomplete is only a suggestion list and
    // doesn't stop a member from submitting an arbitrary string.
    if (!interaction.member.roles.cache.has(role.id)) {
      return interaction.editReply({ content: `❌ You need to be in **${role.name}** to schedule a session.` });
    }

    // Falls back through personal timezone → server timezone → UTC.
    const timezone    = getTimezone(interaction.guildId, interaction.user.id);
    const sessionTime = parseSessionTime(timeInput, timezone);
    if (sessionTime instanceof Error) {
      return interaction.editReply({ content: `❌ ${sessionTime.message}` });
    }

    // Small buffer so a session can't be scheduled for essentially "now",
    // which would leave no time for the reminder timer to make sense and
    // risks the start timer firing before the RSVP embed has even settled.
    if (sessionTime.getTime() - Date.now() < 5 * 60 * 1000) {
      return interaction.editReply({ content: `❌ Please schedule sessions at least 5 minutes in the future.` });
    }

    // Generated up front since the embed, buttons, and timers all need the
    // same id to reference this session before the DB row even exists.
    const sessionId = uuidv4();
    const embed     = buildEmbed(role.name, sessionTime.getTime(), interaction.user.toString(), extraMessage, [], [], cap, recurring);
    const row       = buildButtons(sessionId, false);

    await interaction.editReply({
      content:         `${role}`,
      embeds:          [embed],
      components:      [row],
      allowedMentions: { roles: [role.id] }
    });

    // Need the actual sent Message object (not just the interaction) so it
    // can be edited later in place for RSVP updates and /editschedule.
    const message = await interaction.fetchReply();
    const timers  = scheduleTimers(interaction.client, sessionId, sessionTime.getTime(), role, interaction.channel, interaction.guildId, recurring, interaction.user.tag, cap, extraMessage);

    // In-memory "live" session state, separate from the DB row below. This
    // holds things that don't need to survive a crash mid-interaction (the
    // Message object, timer handles) alongside a live copy of the RSVP
    // arrays that gets mutated directly as buttons are clicked, avoiding a
    // DB read on every click.
    interaction.client.rsvpSessions[sessionId] = {
      rsvpYes:      [],
      rsvpNo:       [],
      message,
      role,
      sessionTime:  sessionTime.getTime(),
      extraMessage,
      cap,
      recurring,
      timers,
    };

    // Persisted separately from the in-memory state above so sessions and
    // RSVPs survive a bot restart — startup restoration in index.js rebuilds
    // the in-memory rsvpSessions entries from these rows.
    addSession({
      id:           sessionId,
      guildId:      interaction.guildId,
      game:         role.name.toLowerCase(),
      time:         sessionTime.getTime(),
      callerTag:    interaction.user.tag,
      channelId:    interaction.channelId,
      messageId:    message.id,
      cancelled:    false,
      rsvpYes:      [],
      rsvpNo:       [],
      extraMessage,
      cap,
      recurring,
    });
  }
};

// Builds the RSVP embed shown on the session message. Shared by the initial
// /schedule post, recurring re-posts, and /editschedule's in-place update —
// keeping it in one place means all three stay visually consistent.
function buildEmbed(gameName, sessionTime, callerMention, extraMessage, rsvpYes = [], rsvpNo = [], cap = null, recurring = false) {
  // Only show an X/cap style label when a cap is actually set — otherwise
  // the "Going" field header stays plain since there's nothing to cap against.
  const capLabel = cap !== null ? ` (${rsvpYes.length}/${cap})` : '';

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`🎮 ${gameName} Session Scheduled!`)
    .setDescription(extraMessage || `A session has been scheduled for **${gameName}**!`)
    .addFields(
      { name: '🕐 Time',             value: `<t:${Math.floor(sessionTime / 1000)}:F> (<t:${Math.floor(sessionTime / 1000)}:R>)`, inline: false },
      { name: '📣 Called by',        value: callerMention,                                                                        inline: true },
      { name: `✅ Going${capLabel}`, value: rsvpYes.length > 0 ? rsvpYes.join('\n') : 'Nobody yet',                              inline: true },
      { name: '❌ Not going',        value: rsvpNo.length > 0  ? rsvpNo.join('\n')  : 'Nobody yet',                              inline: true }
    )
    .setTimestamp();

  // Footer rather than a field — it's a passive indicator, not something
  // members need to interact with or that affects RSVP counts.
  if (recurring) {
    embed.setFooter({ text: '🔁 Repeats weekly' });
  }

  return embed;
}

// `locked` disables the ✅ button once a cap is full, per the caller's
// current RSVP count vs cap — the caller decides when that's true, this
// function only renders the resulting state.
function buildButtons(sessionId, locked = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rsvp_yes_${sessionId}`)
      .setLabel('✅ I\'m in')
      .setStyle(ButtonStyle.Success)
      .setDisabled(locked),
    new ButtonBuilder()
      .setCustomId(`rsvp_no_${sessionId}`)
      .setLabel('❌ Can\'t make it')
      .setStyle(ButtonStyle.Danger)
      // Never locked — members can always back out of a full session,
      // which is also what frees up a spot for someone else.
  );
}

// Given an absolute instant and a target IANA timezone, returns how far
// (in ms) that timezone's wall-clock reading is from UTC at that instant.
// Uses Intl.DateTimeFormat.formatToParts rather than a toLocaleString/
// new Date() string round-trip, because that round-trip's result depends on
// the HOST MACHINE's local system timezone (new Date() with no timezone
// marker in the string parses using local time) — meaning the old approach
// only worked correctly on a UTC-configured machine and silently produced a
// skewed offset everywhere else. formatToParts reads the target timezone's
// wall-clock fields directly with no dependence on the host's own timezone.
function getTimezoneOffsetMs(date, timezone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone:  timezone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

  const parts = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }

  // Treat the target timezone's wall-clock reading for this instant as if
  // it were itself UTC, then compare against the real instant — the
  // difference is exactly the timezone's offset at that moment (correctly
  // accounting for DST, since formatToParts resolves it for the given date).
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
}

// Parses the free-text time input into a concrete Date, interpreted in the
// caller's timezone. Dates are optional (defaults to today, rolling to
// tomorrow if the time has already passed) and years accept 2 or 4 digits.
function parseSessionTime(timeInput, timezone = 'UTC') {
  const parts    = timeInput.trim().split(/\s+/);
  const timePart = parts[0];
  const datePart = parts[1] || null;

  const timeMatch = timePart.match(/^(\d{1,2}):(\d{2})$/);
  if (!timeMatch) return new Error('Invalid time format. Use `21:30` for today/tomorrow or `21:30 25/04/27` for a specific date.');

  const hours   = parseInt(timeMatch[1]);
  const minutes = parseInt(timeMatch[2]);
  if (hours > 23 || minutes > 59) return new Error('Invalid time. Hours must be 0-23 and minutes 0-59.');

  // "Now" as understood in the target timezone, used to fill in day/month/
  // year when the member only supplies a time (no date part).
  const nowInTz = new Date(new Date().toLocaleString('en-US', { timeZone: timezone }));
  let day, month, year;

  if (datePart) {
    const dateMatch = datePart.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
    if (!dateMatch) return new Error('Invalid date format. Use `25/04`, `25/04/27`, or `25/04/2027`.');
    day   = parseInt(dateMatch[1]);
    month = parseInt(dateMatch[2]) - 1;
    if (dateMatch[3]) {
      const rawYear = parseInt(dateMatch[3]);
      // Treat anything under 100 as a 2-digit year in the 2000s rather than
      // requiring the full 4 digits every time.
      year = rawYear < 100 ? 2000 + rawYear : rawYear;
    } else {
      year = nowInTz.getFullYear();
    }
  } else {
    // No date supplied — assume today in the caller's timezone; the
    // "already passed today" case is handled by rolling forward a day below.
    day   = nowInTz.getDate();
    month = nowInTz.getMonth();
    year  = nowInTz.getFullYear();
  }

  // Build the target wall-clock time as if it were UTC (a placeholder
  // instant), then correct it by the target timezone's actual offset at
  // that moment via getTimezoneOffsetMs — see that function's comment for
  // why it's implemented the way it is (avoiding host-machine timezone
  // dependence, and correctly resolving DST for the specific date).
  const targetStr   = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
  const tempDate    = new Date(`${targetStr}Z`);
  const tzOffset    = getTimezoneOffsetMs(tempDate, timezone);
  const sessionTime = new Date(tempDate.getTime() - tzOffset);

  if (isNaN(sessionTime.getTime())) return new Error('That date doesn\'t look valid.');

  if (sessionTime.getTime() < Date.now()) {
    // A specific date in the past is a genuine mistake and should be
    // rejected outright, but a bare time (no date) that's already passed
    // today almost certainly means "tomorrow at this time" — silently
    // rolling forward avoids a confusing round-trip error for the common case.
    if (datePart) return new Error('That date is in the past. Please pick a future date.');
    sessionTime.setUTCDate(sessionTime.getUTCDate() + 1);
  }

  return sessionTime;
}

// setTimeout's delay is a 32-bit signed int internally, so it overflows and
// fires immediately for delays beyond ~24.8 days. Sessions can be scheduled
// further out than that (e.g. recurring chains), so long delays are chained
// through repeated MAX_TIMEOUT-sized hops until the remainder fits.
function safeTimeout(fn, delay) {
  if (delay > MAX_TIMEOUT) {
    // Recurse rather than loop — each hop only needs to know the remaining
    // delay, and the recursion naturally stops once it drops under the cap.
    const t = setTimeout(() => safeTimeout(fn, delay - MAX_TIMEOUT), MAX_TIMEOUT);
    return t;
  }
  return setTimeout(fn, delay);
}

// Sets up the 30-minute reminder and session-start timers. Both delays are
// guarded with `> 0` since this is also called during startup restoration,
// where a session's reminder window (or even the session itself) may already
// have passed while the bot was offline — in that case the timer is simply
// skipped rather than firing negative-delay timeouts immediately.
function scheduleTimers(client, sessionId, sessionTime, role, channel, guildId, recurring = false, callerTag = null, cap = null, extraMessage = '') {
  const now           = Date.now();
  const startDelay    = sessionTime - now;
  const reminderDelay = startDelay - 30 * 60 * 1000;

  let reminderTimer = null;
  let startTimer    = null;

  if (reminderDelay > 0) {
    reminderTimer = safeTimeout(async () => {
      // The session may have been cancelled since this timer was scheduled —
      // cancellation clears the rsvpSessions entry, so this is effectively
      // the "is this still live" check.
      const liveSession = client.rsvpSessions[sessionId];
      if (!liveSession) return;

      // Filter role.members once and derive both the mention strings and the
      // allowedMentions id list from the same filtered collection, rather
      // than re-running the same filter a second time for the id list.
      const mutedUserIds   = getMutedUsers(guildId, role.name);
      const activeMembers  = role.members.filter(m => !mutedUserIds.includes(m.id));
      const targets        = activeMembers.map(m => m.toString());

      // Nothing to send (and no reason to ping an empty allowedMentions
      // list) if every member of the group has muted reminders.
      if (targets.length === 0) return;

      await channel.send({
        content:         `⏰ ${targets.join(' ')} — **${role.name}** session starts in **30 minutes**! Check in above.`,
        allowedMentions: { users: activeMembers.map(m => m.id) }
      });
    }, reminderDelay);
  }

  if (startDelay > 0) {
    startTimer = safeTimeout(async () => {
      const liveSession = client.rsvpSessions[sessionId];
      if (!liveSession) return;

      const mutedUserIds  = getMutedUsers(guildId, role.name);
      const activeMembers = role.members.filter(m => !mutedUserIds.includes(m.id));
      const targets       = activeMembers.map(m => m.toString());

      if (targets.length === 0) return;

      // Read RSVP state from the live session object at fire time, not from
      // any value captured when the timer was created — the whole point is
      // to reflect however many people have RSVPd by the time it actually starts.
      const going = liveSession.rsvpYes.length > 0
        ? liveSession.rsvpYes.join(', ')
        : 'Nobody RSVPd';

      await channel.send({
        content:         `🚀 ${targets.join(' ')} — **${role.name}** session is **starting now!** Players in: ${going}`,
        allowedMentions: { users: activeMembers.map(m => m.id) }
      });

      // Schedule next occurrence if recurring. This block re-invokes
      // scheduleTimers with recurring=true so the chain continues
      // indefinitely — each occurrence posts its own embed and queues the
      // one after it once it starts. Each occurrence is otherwise fully
      // independent (own id, own DB row), so cancelling one doesn't touch
      // the rest of the chain — see the Known Limitations note in the README.
      if (recurring) {
        try {
          const nextTime  = sessionTime + WEEK_MS;
          const nextId    = uuidv4();
          const nextEmbed = buildEmbed(role.name, nextTime, callerTag, extraMessage, [], [], cap, true);
          const nextRow   = buildButtons(nextId, false);

          const nextMessage = await channel.send({
            content:         `${role}`,
            embeds:          [nextEmbed],
            components:      [nextRow],
            allowedMentions: { roles: [role.id] }
          });

          const nextTimers = scheduleTimers(client, nextId, nextTime, role, channel, guildId, true, callerTag, cap, extraMessage);

          client.rsvpSessions[nextId] = {
            rsvpYes:      [],
            rsvpNo:       [],
            message:      nextMessage,
            role,
            sessionTime:  nextTime,
            extraMessage,
            cap,
            recurring:    true,
            timers:       nextTimers,
          };

          addSession({
            id:           nextId,
            guildId,
            game:         role.name.toLowerCase(),
            time:         nextTime,
            callerTag,
            channelId:    channel.id,
            messageId:    nextMessage.id,
            cancelled:    false,
            rsvpYes:      [],
            rsvpNo:       [],
            extraMessage,
            cap,
            recurring:    true,
          });

          console.log(`🔁 Scheduled next recurring session for ${role.name} at ${new Date(nextTime).toLocaleString()}`);
        } catch (err) {
          // Swallow rather than throw — this runs inside a fired timer with
          // no interaction to reply to, so the only sensible action if
          // channel.send or the DB write fails is to log it and move on;
          // the current (already-started) session shouldn't be affected.
          console.error('Failed to create next recurring session:', err.message);
        }
      }
    }, startDelay);
  }

  return { reminderTimer, startTimer };
}

module.exports.scheduleTimers   = scheduleTimers;
module.exports.buildEmbed       = buildEmbed;
module.exports.buildButtons     = buildButtons;
module.exports.parseSessionTime = parseSessionTime;