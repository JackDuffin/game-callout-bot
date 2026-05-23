const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { getSessions, updateSession, getTimezone } = require('../utils/sessionStore');
const { buildEmbed, parseSessionTime, scheduleTimers } = require('./schedule');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('editschedule')
    .setDescription('Edit a session you scheduled')
    .addStringOption(opt =>
      opt.setName('game')
        .setDescription('The game session to edit')
        .setRequired(true))
    .addStringOption(opt =>
      opt.setName('time')
        .setDescription('New time e.g. 21:30 or 21:30 25/04/27')
        .setRequired(false))
    .addStringOption(opt =>
      opt.setName('message')
        .setDescription('New message (use "none" to clear it)')
        .setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });

    const input = interaction.options.getString('game').toLowerCase();
    const newTimeInput = interaction.options.getString('time');
    const newMessage = interaction.options.getString('message');

    if (!newTimeInput && !newMessage) {
      return interaction.editReply({ content: '❌ Please provide a new time, a new message, or both.' });
    }

    const sessions = getSessions(interaction.guildId);
    const userSessions = sessions.filter(s =>
      s.game.toLowerCase() === input &&
      s.callerTag === interaction.user.tag
    );

    if (userSessions.length === 0) {
      const allForGame = sessions.filter(s => s.game.toLowerCase() === input);
      if (allForGame.length > 0) {
        return interaction.editReply({ content: `❌ You didn't schedule any upcoming **${input}** sessions — only the person who scheduled it can edit it.` });
      }
      return interaction.editReply({ content: `❌ No upcoming session found for **${input}**.` });
    }

    if (userSessions.length === 1) {
      return applyEdit(interaction, userSessions[0], newTimeInput, newMessage, false);
    }

    // Multiple sessions — show select menu
    const options = userSessions
      .sort((a, b) => a.time - b.time)
      .map(s => ({
        label: `${s.game} — ${new Date(s.time).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}`,
        description: new Date(s.time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }),
        value: s.id
      }));

    if (!interaction.client.pendingEdits) interaction.client.pendingEdits = {};
    interaction.client.pendingEdits[interaction.user.id] = { newTimeInput, newMessage };

    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('edit_select')
        .setPlaceholder('Pick the session to edit')
        .addOptions(options)
    );

    await interaction.editReply({
      content: `You have **${userSessions.length}** upcoming ${input} sessions — which one do you want to edit?`,
      components: [row]
    });
  }
};

async function applyEdit(interaction, session, newTimeInput, newMessage, fromSelect = false) {
  const liveSession = interaction.client.rsvpSessions?.[session.id];

  let newSessionTime = null;
  if (newTimeInput) {
    const timezone = getTimezone(interaction.guildId, interaction.user.id);
    const parsed = parseSessionTime(newTimeInput, timezone);
    if (parsed instanceof Error) {
      const msg = { content: `❌ ${parsed.message}`, flags: 64 };
      return fromSelect ? interaction.followUp(msg) : interaction.editReply(msg);
    }
    if (parsed.getTime() - Date.now() < 5 * 60 * 1000) {
      const msg = { content: '❌ Please schedule sessions at least 5 minutes in the future.', flags: 64 };
      return fromSelect ? interaction.followUp(msg) : interaction.editReply(msg);
    }
    newSessionTime = parsed;
  }

  const updatedTime = newSessionTime ? newSessionTime.getTime() : session.time;
  const updatedMessage = newMessage === 'none' ? '' : (newMessage ?? session.extraMessage ?? '');

  updateSession(session.id, {
    time: updatedTime,
    extraMessage: updatedMessage
  });

  if (liveSession) {
    if (newSessionTime) {
      liveSession.sessionTime = updatedTime;

      if (liveSession.timers) {
        clearTimeout(liveSession.timers.reminderTimer);
        clearTimeout(liveSession.timers.startTimer);
      }

      try {
        const channel = await interaction.client.channels.fetch(session.channelId);
        liveSession.timers = scheduleTimers(interaction.client, session.id, updatedTime, liveSession.role, channel);
      } catch (err) {
        console.error('Failed to reschedule timers:', err.message);
      }
    }

    if (newMessage !== null) {
      liveSession.extraMessage = updatedMessage;
    }

    if (liveSession.message) {
      try {
        const callerMention = liveSession.message.embeds[0]?.fields?.find(f => f.name === '📣 Called by')?.value
          ?? interaction.user.toString();

        const updatedEmbed = buildEmbed(
          session.game,
          updatedTime,
          callerMention,
          updatedMessage,
          liveSession.rsvpYes,
          liveSession.rsvpNo
        );

        await liveSession.message.edit({ embeds: [updatedEmbed] });
      } catch (err) {
        console.error('Failed to edit session embed:', err.message);
      }
    }
  }

  const changes = [];
  if (newSessionTime) changes.push(`🕐 Time → <t:${Math.floor(updatedTime / 1000)}:F>`);
  if (newMessage !== null) changes.push(`💬 Message → ${updatedMessage || '*(cleared)*'}`);

  const msg = { content: `✅ Session updated!\n${changes.join('\n')}`, flags: 64 };
  return fromSelect ? interaction.followUp(msg) : interaction.editReply(msg);
}

module.exports.applyEdit = applyEdit;