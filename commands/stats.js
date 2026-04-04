const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getStats } = require('../utils/sessionStore');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('View session stats for a game or all games')
    .addStringOption(opt =>
      opt.setName('game')
        .setDescription('Game to check stats for (leave blank for all)')
        .setRequired(false)),

  async execute(interaction) {
    const gameName = interaction.options.getString('game');
    const stats = getStats(gameName?.toLowerCase());

    if (!stats || Object.keys(stats).length === 0) {
      return interaction.reply({ content: `📊 No stats found${gameName ? ` for **${gameName}**` : ''} yet.`, flags: 64 });
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(`📊 Session Stats${gameName ? ` — ${gameName}` : ''}`)
      .setTimestamp();

    const entries = gameName ? { [gameName.toLowerCase()]: stats } : stats;

    for (const [game, data] of Object.entries(entries)) {
      const topCaller = Object.entries(data.callers).sort((a, b) => b[1] - a[1])[0];
      const lastSession = data.lastSession ? `<t:${Math.floor(data.lastSession / 1000)}:R>` : 'N/A';
      embed.addFields({
        name: `🎮 ${game}`,
        value: `Sessions: **${data.count}** | Top caller: **${topCaller ? topCaller[0] : 'N/A'}** | Last: ${lastSession}`,
        inline: false
      });
    }

    await interaction.reply({ embeds: [embed], flags: 64 });
  }
};