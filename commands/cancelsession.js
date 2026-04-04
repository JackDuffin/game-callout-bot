const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { getSessions, cancelSession } = require('../utils/sessionStore');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cancelsession')
    .setDescription('Cancel a session you scheduled')
    .addStringOption(opt =>
      opt.setName('game')
        .setDescription('The game session to cancel')
        .setRequired(true)),

  async execute(interaction) {
    const input = interaction.options.getString('game').toLowerCase();
    const sessions = getSessions();

    const userSessions = sessions.filter(s =>
      s.game.toLowerCase() === input &&
      s.callerTag === interaction.user.tag
    );

    if (userSessions.length === 0) {
      const allForGame = sessions.filter(s => s.game.toLowerCase() === input);
      if (allForGame.length > 0) {
        return interaction.reply({ content: `❌ You didn't schedule any upcoming **${input}** sessions — only the person who scheduled it can cancel it.`, flags: 64 });
      }
      return interaction.reply({ content: `❌ No upcoming session found for **${input}**.`, flags: 64 });
    }

    if (userSessions.length === 1) {
      const session = userSessions[0];
      cancelSession(session.id);

      const liveSession = interaction.client.rsvpSessions?.[session.id];
      if (liveSession?.message) {
        try {
          await liveSession.message.edit({ components: [] });
        } catch {
          // Message may have been deleted
        }
      }
      delete interaction.client.rsvpSessions?.[session.id];

      return interaction.reply({
        content: `✅ The **${session.game}** session scheduled for <t:${Math.floor(session.time / 1000)}:F> has been cancelled.`
      });
    }

    // Multiple sessions — show select menu
    const options = userSessions
      .sort((a, b) => a.time - b.time)
      .map(s => ({
        label: `${s.game} — ${new Date(s.time).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}`,
        description: `${new Date(s.time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}`,
        value: s.id
      }));

    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('cancel_select')
        .setPlaceholder('Pick the session to cancel')
        .addOptions(options)
    );

    await interaction.reply({
      content: `You have **${userSessions.length}** upcoming ${input} sessions — which one do you want to cancel?`,
      components: [row],
      flags: 64
    });
  }
};