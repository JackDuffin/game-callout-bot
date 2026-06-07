const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { addSession, getTimezone, getMutedUsers } = require('../utils/sessionStore');
const { v4: uuidv4 } = require('uuid');

const MAX_TIMEOUT = 2_147_483_647;

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
        .setDescription('Max number of players (leave blank for unlimited)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(99))
    .addStringOption(opt =>
      opt.setName('message')
        .setDescription('Optional extra message')
        .setRequired(false)),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const guild   = interaction.guild;
    const roles   = guild.roles.cache
      .filter(r => r.name !== '@everyone' && !r.managed && interaction.member.roles.cache.has(r.id))
      .map(r => r.name);

    const filtered = roles.filter(name => name.toLowerCase().includes(focused)).slice(0, 25);
    await interaction.respond(filtered.map(name => ({ name, value: name })));
  },

  async execute(interaction) {
    console.log('execute started at', Date.now());
    await interaction.deferReply();
    console.log('deferred at', Date.now());

    const gameName     = interaction.options.getString('game');
    const timeInput    = interaction.options.getString('time').trim();
    const cap          = interaction.options.getInteger('cap') ?? null;
    const extraMessage = interaction.options.getString('message') || '';
    const guild        = interaction.guild;

    console.log('Cap value received:', cap);

    const gameRoles = guild.roles.cache.filter(r => r.name !== '@everyone' && !r.managed);
    const role      = gameRoles.find(r => r.name.toLowerCase() === gameName.toLowerCase() || r.id === gameName);

    if (!role) {
      const list = gameRoles.map(r => `• ${r.name}`).join('\n');
      return interaction.editReply({ content: `❌ No game group called **${gameName}**. Available groups:\n${list}` });
    }

    if (!interaction.member.roles.cache.has(role.id)) {
      return interaction.editReply({ content: `❌ You need to be in **${role.name}** to schedule a session.` });
    }

    const timezone    = getTimezone(interaction.guildId, interaction.user.id);
    const sessionTime = parseSessionTime(timeInput, timezone);
    if (sessionTime instanceof Error) {
      return interaction.editReply({ content: `❌ ${sessionTime.message}` });
    }

    if (sessionTime.getTime() - Date.now() < 5 * 60 * 1000) {
      return interaction.editReply({ content: `❌ Please schedule sessions at least 5 minutes in the future.` });
    }

    const sessionId = uuidv4();
    const embed     = buildEmbed(role.name, sessionTime.getTime(), interaction.user.toString(), extraMessage, [], [], cap);
    const row       = buildButtons(sessionId, false);

    await interaction.editReply({
      content:         `${role}`,
      embeds:          [embed],
      components:      [row],
      allowedMentions: { roles: [role.id] }
    });

    const message = await interaction.fetchReply();
    const timers  = scheduleTimers(interaction.client, sessionId, sessionTime.getTime(), role, interaction.channel, interaction.guildId);

    interaction.client.rsvpSessions[sessionId] = {
      rsvpYes:      [],
      rsvpNo:       [],
      message,
      role,
      sessionTime:  sessionTime.getTime(),
      extraMessage,
      cap,
      timers,
    };

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
    });
  }
};

function buildEmbed(gameName, sessionTime, callerMention, extraMessage, rsvpYes = [], rsvpNo = [], cap = null) {
  const capLabel = cap !== null ? ` (${rsvpYes.length}/${cap})` : '';

  return new EmbedBuilder()
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
}

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
  );
}

function parseSessionTime(timeInput, timezone = 'UTC') {
  const parts    = timeInput.trim().split(/\s+/);
  const timePart = parts[0];
  const datePart = parts[1] || null;

  const timeMatch = timePart.match(/^(\d{1,2}):(\d{2})$/);
  if (!timeMatch) return new Error('Invalid time format. Use `21:30` for today/tomorrow or `21:30 25/04/27` for a specific date.');

  const hours   = parseInt(timeMatch[1]);
  const minutes = parseInt(timeMatch[2]);
  if (hours > 23 || minutes > 59) return new Error('Invalid time. Hours must be 0-23 and minutes 0-59.');

  const nowInTz = new Date(new Date().toLocaleString('en-US', { timeZone: timezone }));
  let day, month, year;

  if (datePart) {
    const dateMatch = datePart.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
    if (!dateMatch) return new Error('Invalid date format. Use `25/04`, `25/04/27`, or `25/04/2027`.');
    day   = parseInt(dateMatch[1]);
    month = parseInt(dateMatch[2]) - 1;
    if (dateMatch[3]) {
      const rawYear = parseInt(dateMatch[3]);
      year = rawYear < 100 ? 2000 + rawYear : rawYear;
    } else {
      year = nowInTz.getFullYear();
    }
  } else {
    day   = nowInTz.getDate();
    month = nowInTz.getMonth();
    year  = nowInTz.getFullYear();
  }

  const targetStr   = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
  const tempDate    = new Date(`${targetStr}Z`);
  const tzOffset    = new Date(tempDate.toLocaleString('en-US', { timeZone: timezone })) - tempDate;
  const sessionTime = new Date(tempDate.getTime() - tzOffset);

  if (isNaN(sessionTime.getTime())) return new Error('That date doesn\'t look valid.');

  if (sessionTime.getTime() < Date.now()) {
    if (datePart) return new Error('That date is in the past. Please pick a future date.');
    sessionTime.setUTCDate(sessionTime.getUTCDate() + 1);
  }

  return sessionTime;
}

function safeTimeout(fn, delay) {
  if (delay > MAX_TIMEOUT) {
    const t = setTimeout(() => safeTimeout(fn, delay - MAX_TIMEOUT), MAX_TIMEOUT);
    return t;
  }
  return setTimeout(fn, delay);
}

function scheduleTimers(client, sessionId, sessionTime, role, channel, guildId) {
  const now           = Date.now();
  const startDelay    = sessionTime - now;
  const reminderDelay = startDelay - 30 * 60 * 1000;

  let reminderTimer = null;
  let startTimer    = null;

  if (reminderDelay > 0) {
    reminderTimer = safeTimeout(async () => {
      const liveSession = client.rsvpSessions[sessionId];
      if (!liveSession) return;

      const mutedUserIds = getMutedUsers(guildId, role.name);
      const targets      = role.members
        .filter(m => !mutedUserIds.includes(m.id))
        .map(m => m.toString());

      if (targets.length === 0) return;

      await channel.send({
        content:         `⏰ ${targets.join(' ')} — **${role.name}** session starts in **30 minutes**! Check in above.`,
        allowedMentions: { users: role.members.filter(m => !mutedUserIds.includes(m.id)).map(m => m.id) }
      });
    }, reminderDelay);
  }

  if (startDelay > 0) {
    startTimer = safeTimeout(async () => {
      const liveSession = client.rsvpSessions[sessionId];
      if (!liveSession) return;

      const mutedUserIds = getMutedUsers(guildId, role.name);
      const targets      = role.members
        .filter(m => !mutedUserIds.includes(m.id))
        .map(m => m.toString());

      if (targets.length === 0) return;

      const going = liveSession.rsvpYes.length > 0
        ? liveSession.rsvpYes.join(', ')
        : 'Nobody RSVPd';

      await channel.send({
        content:         `🚀 ${targets.join(' ')} — **${role.name}** session is **starting now!** Players in: ${going}`,
        allowedMentions: { users: role.members.filter(m => !mutedUserIds.includes(m.id)).map(m => m.id) }
      });
    }, startDelay);
  }

  return { reminderTimer, startTimer };
}

module.exports.scheduleTimers   = scheduleTimers;
module.exports.buildEmbed       = buildEmbed;
module.exports.buildButtons     = buildButtons;
module.exports.parseSessionTime = parseSessionTime;