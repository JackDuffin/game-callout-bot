const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { addSession, getTimezone } = require('../utils/sessionStore');
const { v4: uuidv4 } = require('uuid');

const MAX_TIMEOUT = 2_147_483_647;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('schedule')
    .setDescription('Schedule a game session')
    .addStringOption(opt =>
      opt.setName('game')
        .setDescription('Which game group to schedule for')
        .setRequired(true))
    .addStringOption(opt =>
      opt.setName('time')
        .setDescription('e.g. 21:30 or 21:30 25/04 or 21:30 25/04/27 or 21:30 25/04/2027')
        .setRequired(true))
    .addStringOption(opt =>
      opt.setName('message')
        .setDescription('Optional extra message')
        .setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply();

    const gameName = interaction.options.getString('game');
    const timeInput = interaction.options.getString('time').trim();
    const extraMessage = interaction.options.getString('message') || '';
    const guild = interaction.guild;

    const gameRoles = guild.roles.cache.filter(r => r.name !== '@everyone' && !r.managed);
    const role = gameRoles.find(r => r.name.toLowerCase() === gameName.toLowerCase() || r.id === gameName);

    if (!role) {
      const list = gameRoles.map(r => `• ${r.name}`).join('\n');
      return interaction.editReply({ content: `❌ No game group called **${gameName}**. Available groups:\n${list}` });
    }

    if (!interaction.member.roles.cache.has(role.id)) {
      return interaction.editReply({ content: `❌ You need to be in **${role.name}** to schedule a session.` });
    }

    const timezone = getTimezone(interaction.guildId, interaction.user.id);
    const sessionTime = parseSessionTime(timeInput, timezone);
    if (sessionTime instanceof Error) {
      return interaction.editReply({ content: `❌ ${sessionTime.message}` });
    }

    if (sessionTime.getTime() - Date.now() < 5 * 60 * 1000) {
      return interaction.editReply({ content: `❌ Please schedule sessions at least 5 minutes in the future.` });
    }

    const sessionId = uuidv4();

    const embed = buildEmbed(role.name, sessionTime.getTime(), interaction.user.toString(), extraMessage);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`rsvp_yes_${sessionId}`).setLabel('✅ I\'m in').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`rsvp_no_${sessionId}`).setLabel('❌ Can\'t make it').setStyle(ButtonStyle.Danger)
    );

    await interaction.editReply({
      content: `${role}`,
      embeds: [embed],
      components: [row],
      allowedMentions: { roles: [role.id] }
    });

    const message = await interaction.fetchReply();

    const timers = scheduleTimers(interaction.client, sessionId, sessionTime.getTime(), role, interaction.channel);

    interaction.client.rsvpSessions[sessionId] = {
      rsvpYes: [],
      rsvpNo: [],
      message,
      role,
      sessionTime: sessionTime.getTime(),
      extraMessage,
      timers
    };

    addSession({
      id: sessionId,
      guildId: interaction.guildId,
      game: role.name.toLowerCase(),
      time: sessionTime.getTime(),
      callerTag: interaction.user.tag,
      channelId: interaction.channelId,
      messageId: message.id,
      cancelled: false,
      rsvpYes: [],
      rsvpNo: [],
      extraMessage
    });
  }
};

function buildEmbed(gameName, sessionTime, callerMention, extraMessage, rsvpYes = [], rsvpNo = []) {
  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`🎮 ${gameName} Session Scheduled!`)
    .setDescription(extraMessage || `A session has been scheduled for **${gameName}**!`)
    .addFields(
      { name: '🕐 Time', value: `<t:${Math.floor(sessionTime / 1000)}:F> (<t:${Math.floor(sessionTime / 1000)}:R>)`, inline: false },
      { name: '📣 Called by', value: callerMention, inline: true },
      { name: '✅ Going', value: rsvpYes.length > 0 ? rsvpYes.join('\n') : 'Nobody yet', inline: true },
      { name: '❌ Not going', value: rsvpNo.length > 0 ? rsvpNo.join('\n') : 'Nobody yet', inline: true }
    )
    .setTimestamp();
}

function parseSessionTime(timeInput, timezone = 'UTC') {
  const parts = timeInput.trim().split(/\s+/);
  const timePart = parts[0];
  const datePart = parts[1] || null;

  const timeMatch = timePart.match(/^(\d{1,2}):(\d{2})$/);
  if (!timeMatch) return new Error('Invalid time format. Use `21:30` for today/tomorrow or `21:30 25/04/27` for a specific date.');

  const hours = parseInt(timeMatch[1]);
  const minutes = parseInt(timeMatch[2]);

  if (hours > 23 || minutes > 59) return new Error('Invalid time. Hours must be 0-23 and minutes 0-59.');

  // Get current date in the target timezone
  const nowInTz = new Date(new Date().toLocaleString('en-US', { timeZone: timezone }));

  let day, month, year;

  if (datePart) {
    const dateMatch = datePart.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
    if (!dateMatch) return new Error('Invalid date format. Use `25/04`, `25/04/27`, or `25/04/2027`.');

    day = parseInt(dateMatch[1]);
    month = parseInt(dateMatch[2]) - 1;

    if (dateMatch[3]) {
      const rawYear = parseInt(dateMatch[3]);
      year = rawYear < 100 ? 2000 + rawYear : rawYear;
    } else {
      year = nowInTz.getFullYear();
    }
  } else {
    day = nowInTz.getDate();
    month = nowInTz.getMonth();
    year = nowInTz.getFullYear();
  }

  // Build the target time string in the given timezone and convert to UTC
  const targetStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;

  // Use Intl to find the UTC offset for this timezone at this moment
  const tempDate = new Date(`${targetStr}Z`);
  const tzOffset = new Date(tempDate.toLocaleString('en-US', { timeZone: timezone })) - tempDate;
  const sessionTime = new Date(tempDate.getTime() - tzOffset);

  if (isNaN(sessionTime.getTime())) return new Error('That date doesn\'t look valid.');

  if (sessionTime.getTime() < Date.now()) {
    if (datePart) return new Error('That date is in the past. Please pick a future date.');
    // No date given and time has passed — roll to tomorrow
    sessionTime.setUTCDate(sessionTime.getUTCDate() + 1);
  }

  return sessionTime;
}

function safeTimeout(fn, delay) {
  if (delay > MAX_TIMEOUT) {
    const t = setTimeout(() => safeTimeout(fn, delay - MAX_TIMEOUT), MAX_TIMEOUT);
    return t;
  } else {
    return setTimeout(fn, delay);
  }
}

function scheduleTimers(client, sessionId, sessionTime, role, channel) {
  const now = Date.now();
  const startDelay = sessionTime - now;
  const reminderDelay = sessionTime - now - 30 * 60 * 1000;

  let reminderTimer = null;
  let startTimer = null;

  if (reminderDelay > 0) {
    reminderTimer = safeTimeout(async () => {
      const liveSession = client.rsvpSessions[sessionId];
      if (!liveSession) return;
      await channel.send({
        content: `⏰ ${role} — session starts in **30 minutes**! Check in above.`,
        allowedMentions: { roles: [role.id] }
      });
    }, reminderDelay);
  }

  if (startDelay > 0) {
    startTimer = safeTimeout(async () => {
      const liveSession = client.rsvpSessions[sessionId];
      if (!liveSession) return;
      const going = liveSession.rsvpYes.length > 0
        ? liveSession.rsvpYes.join(', ')
        : 'Nobody RSVPd';
      await channel.send({
        content: `🚀 ${role} — **session is starting now!** Players in: ${going}`,
        allowedMentions: { roles: [role.id] }
      });
    }, startDelay);
  }

  return { reminderTimer, startTimer };
}

module.exports.scheduleTimers = scheduleTimers;
module.exports.buildEmbed = buildEmbed;
module.exports.parseSessionTime = parseSessionTime;