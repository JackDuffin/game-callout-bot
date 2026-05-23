const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getHistory } = require('../utils/sessionStore');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('history')
    .setDescription('View past sessions')
    .addStringOption(opt =>
      opt.setName('game')
        .setDescription('Filter by game (leave blank for all)')
        .setRequired(false)),

  async execute(interaction) {
    const gameName = interaction.options.getString('game');
    const history = getHistory(interaction.guildId, gameName, 10);

    if (history.length === 0) {
      return interaction.reply({
        content: `📭 No past sessions found${gameName ? ` for **${gameName}**` : ''}.`,
        flags: 64
      });
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(`📜 Session History${gameName ? ` — ${gameName}` : ''}`)
      .setFooter({ text: `Showing last ${history.length} session${history.length === 1 ? '' : 's'}` })
      .setTimestamp();

    history.forEach(s => {
      const yesCount = (s.rsvpYes || []).length;
      embed.addFields({
        name: `🎮 ${s.game}`,
        value: `<t:${Math.floor(s.time / 1000)}:F>\nCalled by: ${s.callerTag} | ✅ ${yesCount} went`,
        inline: false
      });
    });

    await interaction.reply({ embeds: [embed], flags: 64 });
  }
};