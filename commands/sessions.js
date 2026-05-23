const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getSessions } = require('../utils/sessionStore');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sessions')
    .setDescription('View all upcoming scheduled sessions'),

  async execute(interaction) {
    const upcoming = getSessions(interaction.guildId);

    if (upcoming.length === 0) {
      return interaction.reply({ content: '📭 No sessions scheduled yet. Use /schedule to set one up!', flags: 64 });
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('📅 Upcoming Sessions')
      .setTimestamp();

    upcoming.forEach(s => {
      const yesCount = (s.rsvpYes || []).length;
      embed.addFields({
        name: `🎮 ${s.game}`,
        value: `<t:${Math.floor(s.time / 1000)}:F> (<t:${Math.floor(s.time / 1000)}:R>)\nCalled by: ${s.callerTag} | ✅ ${yesCount} going`,
        inline: false
      });
    });

    await interaction.reply({ embeds: [embed], flags: 64 });
  }
};