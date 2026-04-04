const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { addSession } = require('../utils/sessionStore');
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
    const gameName = interaction.options.getString('game');
    const timeInput = interaction.options.getString('time').trim();
    const extraMessage = interaction.options.getString('message') || '';
    const guild = interaction.guild;

    const gameRoles = guild.roles.cache.filter(r => r.name !== '@everyone' && !r.managed);
    const role = gameRoles.find(r => r.name.toLowerCase() === gameName.toLowerCase() || r.id === gameName);

    if (!role) {
      const list = gameRoles.map(r => `• ${r.name}`).join('\n');
      return interaction.reply({ content: `❌ No game group called **${gameName}**. Available groups:\n${list}`, flags: 64 });
    }

    if (!interaction.member.roles.cache.has(role.id)) {
      return interaction.reply({ content: `❌ You need to be in **${role.name}** to schedule a session.`, flags: 64 });
    }

    // Split input into time part and optional date part
    // Supports: "21:30" | "21:30 25/04" | "21:30 25/04/27" | "21:30 25/04/2027"
    const parts = timeInput.split(/\s+/);
    const timePart = parts[0];
    const datePart = parts[1] || null;

    // Validate time part
    const timeMatch = timePart.match(/^(\d{1,2}):(\d{2})$/);
    if (!timeMatch) {
      return interaction.reply({ content: `❌ Invalid time format. Use \`21:30\` for today/tomorrow or \`21:30 25/04/27\` for a specific date.`, flags: 64 });
    }

    const hours = parseInt(timeMatch[1]);
    const minutes = parseInt(timeMatch[2]);

    if (hours > 23 || minutes > 59) {
      return interaction.reply({ content: `❌ Invalid time. Hours must be 0-23 and minutes 0-59.`, flags: 64 });
    }

    let sessionTime;

    if (datePart) {
      // Validate date part — supports DD/MM, DD/MM/YY, DD/MM/YYYY
      const dateMatch = datePart.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
      if (!dateMatch) {
        return interaction.reply({ content: `❌ Invalid date format. Use \`25/04\`, \`25/04/27\`, or \`25/04/2027\`.`, flags: 64 });
      }

      const day = parseInt(dateMatch[1]);
      const month = parseInt(dateMatch[2]) - 1;

      let year;
      if (dateMatch[3]) {
        const rawYear = parseInt(dateMatch[3]);
        year = rawYear < 100 ? 2000 + rawYear : rawYear;
      } else {
        year = new Date().getFullYear();
      }

      sessionTime = new Date(year, month, day, hours, minutes, 0, 0);

      if (isNaN(sessionTime.getTime())) {
        return interaction.reply({ content: `❌ That date doesn't look valid. Use \`25/04\`, \`25/04/27\`, or \`25/04/2027\`.`, flags: 64 });
      }

      if (sessionTime.getTime() < Date.now()) {
        return interaction.reply({ content: `❌ That date is in the past. Please pick a future date.`, flags: 64 });
      }
    } else {
      // No date — use today, roll to tomorrow if time has passed
      sessionTime = new Date();
      sessionTime.setHours(hours, minutes, 0, 0);
      if (sessionTime.getTime() < Date.now()) {
        sessionTime.setDate(sessionTime.getDate() + 1);
      }
    }

    if (sessionTime.getTime() - Date.now() < 5 * 60 * 1000) {
      return interaction.reply({ content: `❌ Please schedule sessions at least 5 minutes in the future.`, flags: 64 });
    }

    const sessionId = uuidv4();

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(`🎮 ${role.name} Session Scheduled!`)
      .setDescription(extraMessage || `A session has been scheduled for **${role.name}**!`)
      .addFields(
        { name: '🕐 Time', value: `<t:${Math.floor(sessionTime.getTime() / 1000)}:F> (<t:${Math.floor(sessionTime.getTime() / 1000)}:R>)`, inline: false },
        { name: '📣 Called by', value: interaction.user.toString(), inline: true },
        { name: '✅ Going', value: 'Nobody yet', inline: true },
        { name: '❌ Not going', value: 'Nobody yet', inline: true }
      )
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`rsvp_yes_${sessionId}`).setLabel('✅ I\'m in').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`rsvp_no_${sessionId}`).setLabel('❌ Can\'t make it').setStyle(ButtonStyle.Danger)
    );

    await interaction.reply({
      content: `${role}`,
      embeds: [embed],
      components: [row],
      allowedMentions: { roles: [role.id] }
    });

    const message = await interaction.fetchReply();

    interaction.client.rsvpSessions[sessionId] = {
      rsvpYes: [],
      rsvpNo: [],
      message,
      role,
      sessionTime: sessionTime.getTime()
    };

    addSession({
      id: sessionId,
      game: role.name.toLowerCase(),
      time: sessionTime.getTime(),
      callerTag: interaction.user.tag,
      channelId: interaction.channelId,
      messageId: message.id,
      cancelled: false,
      rsvpYes: [],
      rsvpNo: []
    });

    scheduleTimers(interaction.client, sessionId, sessionTime.getTime(), role, interaction.channel);
  }
};

function safeTimeout(fn, delay) {
  if (delay > MAX_TIMEOUT) {
    setTimeout(() => safeTimeout(fn, delay - MAX_TIMEOUT), MAX_TIMEOUT);
  } else {
    setTimeout(fn, delay);
  }
}

function scheduleTimers(client, sessionId, sessionTime, role, channel) {
  const now = Date.now();
  const startDelay = sessionTime - now;
  const reminderDelay = sessionTime - now - 30 * 60 * 1000;

  if (reminderDelay > 0) {
    safeTimeout(async () => {
      const liveSession = client.rsvpSessions[sessionId];
      if (!liveSession) return;
      await channel.send({
        content: `⏰ ${role} — session starts in **30 minutes**! Check in above.`,
        allowedMentions: { roles: [role.id] }
      });
    }, reminderDelay);
  }

  if (startDelay > 0) {
    safeTimeout(async () => {
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
}

module.exports.scheduleTimers = scheduleTimers;