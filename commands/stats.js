const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getStats, getDetailedStats } = require('../utils/sessionStore');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('View session stats for a game or all games')
    .addStringOption(opt =>
      opt.setName('game')
        .setDescription('Game to check stats for (leave blank for all)')
        .setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });

    const gameName = interaction.options.getString('game');

    // Detailed stats for a specific game
    if (gameName) {
      const basic = getStats(interaction.guildId, gameName.toLowerCase());
      const detailed = getDetailedStats(interaction.guildId, gameName.toLowerCase(), interaction.guild);

      if (!basic) {
        return interaction.editReply({ content: `📊 No stats found for **${gameName}** yet.` });
      }

      const topCaller = Object.entries(basic.callers).sort((a, b) => b[1] - a[1])[0];
      const lastPlayed = basic.lastSession ? `<t:${Math.floor(basic.lastSession / 1000)}:R>` : 'N/A';

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`📊 Stats — ${gameName}`)
        .setTimestamp()
        .addFields(
          { name: '🎮 Sessions Played', value: `**${basic.count}**`, inline: true },
          { name: '📣 Most Active Organiser', value: topCaller ? `**${topCaller[0]}** (${topCaller[1]})` : 'N/A', inline: true },
          { name: '🕐 Last Played', value: lastPlayed, inline: true }
        );

      if (detailed?.groupSize !== null && detailed?.groupSize !== undefined) {
        embed.addFields({ name: '👥 Group Size', value: `**${detailed.groupSize}** members`, inline: true });
      }

      if (!detailed || !detailed.hasEnoughData) {
        embed.addFields({
          name: '📈 Insights',
          value: '_Not enough data yet — schedule at least 3 sessions to unlock insights._',
          inline: false
        });
      } else {
        embed.addFields(
          { name: '📅 Usual Day', value: detailed.peakDay ? `**${detailed.peakDay}**` : 'N/A', inline: true },
          { name: '⏰ Usual Time', value: detailed.peakHour ? `**${detailed.peakHour}**` : 'N/A', inline: true },
          { name: '✅ Average Turnout', value: `**${detailed.avgAttendance}** per session`, inline: true },
          { name: '🏆 Most Reliable Member', value: detailed.topRsvp ? `**${detailed.topRsvp}** (${detailed.topRsvpCount} times)` : 'N/A', inline: true },
          { name: '🔥 Longest Active Streak', value: `**${detailed.longestStreak}** week${detailed.longestStreak === 1 ? '' : 's'}`, inline: true }
        );
      }

      return interaction.editReply({ embeds: [embed] });
    }

    // Compact summary for all games
    const stats = getStats(interaction.guildId, null);

    if (!stats || Object.keys(stats).length === 0) {
      return interaction.editReply({ content: '📊 No stats found yet.' });
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('📊 Session Stats — All Games')
      .setFooter({ text: 'Use /stats <game> for detailed insights' })
      .setTimestamp();

    for (const [game, data] of Object.entries(stats)) {
      const topCaller = Object.entries(data.callers).sort((a, b) => b[1] - a[1])[0];
      const lastPlayed = data.lastSession ? `<t:${Math.floor(data.lastSession / 1000)}:R>` : 'N/A';
      embed.addFields({
        name: `🎮 ${game}`,
        value: `Sessions: **${data.count}** | Top organiser: **${topCaller ? topCaller[0] : 'N/A'}** | Last played: ${lastPlayed}`,
        inline: false
      });
    }

    return interaction.editReply({ embeds: [embed] });
  }
};