const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getStats, getDetailedStats } = require('../utils/sessionStore');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('View session stats for a game or all games')
    .addStringOption(opt =>
      opt.setName('game')
        .setDescription('Game to check stats for (leave blank for all)')
        .setRequired(false)
        .setAutocomplete(true)),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const guild   = interaction.guild;
    // Not restricted to the member's own games — stats are server-wide
    // info, same as /history and /sessions.
    const roles   = guild.roles.cache
      .filter(r => r.name !== '@everyone' && !r.managed)
      .map(r => r.name);

    const filtered = roles.filter(name => name.toLowerCase().includes(focused)).slice(0, 25);
    await interaction.respond(filtered.map(name => ({ name, value: name })));
  },

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });

    const gameName = interaction.options.getString('game');

    if (gameName) {
      // basic covers count/lastSession/callers (always available once a
      // game has any sessions); detailed adds the deeper insights below and
      // can be null if getDetailedStats has nothing to compute from.
      const basic    = getStats(interaction.guildId, gameName.toLowerCase());
      const detailed = getDetailedStats(interaction.guildId, gameName.toLowerCase(), interaction.guild);

      if (!basic) {
        return interaction.editReply({ content: `📊 No stats found for **${gameName}** yet.` });
      }

      const topCaller  = Object.entries(basic.callers).sort((a, b) => b[1] - a[1])[0];
      const lastPlayed = basic.lastSession ? `<t:${Math.floor(basic.lastSession / 1000)}:R>` : 'N/A';

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`📊 Stats — ${gameName}`)
        .setTimestamp()
        .addFields(
          { name: '🎮 Sessions Played',       value: `**${basic.count}**`,                                                 inline: true },
          { name: '📣 Most Active Organiser', value: topCaller ? `**${topCaller[0]}** (${topCaller[1]})` : 'N/A',         inline: true },
          { name: '🕐 Last Played',           value: lastPlayed,                                                           inline: true }
        );

      // Group size relies on the live Discord role/member list rather than
      // anything in the DB, so it's only shown when that lookup succeeded.
      if (detailed?.groupSize !== null && detailed?.groupSize !== undefined) {
        embed.addFields({ name: '👥 Group Size', value: `**${detailed.groupSize}** members`, inline: true });
      }

      // Insights (peak day/time, streaks, etc.) need a minimum sample size
      // to be meaningful — see getDetailedStats' hasEnoughData (3+ past
      // sessions) — otherwise show a placeholder rather than noisy stats
      // from one or two data points.
      if (!detailed || !detailed.hasEnoughData) {
        embed.addFields({
          name:   '📈 Insights',
          value:  '_Not enough data yet — schedule at least 3 sessions to unlock insights._',
          inline: false
        });
      } else {
        embed.addFields(
          { name: '📅 Usual Day',              value: detailed.peakDay  ? `**${detailed.peakDay}**`                                   : 'N/A', inline: true },
          { name: '⏰ Usual Time',             value: detailed.peakHour ? `**${detailed.peakHour}**`                                  : 'N/A', inline: true },
          { name: '✅ Average Turnout',        value: `**${detailed.avgAttendance}** per session`,                                             inline: true },
          { name: '🏆 Most Reliable Member',  value: detailed.topRsvp  ? `**${detailed.topRsvp}** (${detailed.topRsvpCount} times)`  : 'N/A', inline: true },
          { name: '🔥 Longest Active Streak', value: `**${detailed.longestStreak}** week${detailed.longestStreak === 1 ? '' : 's'}`,          inline: true }
        );
      }

      return interaction.editReply({ embeds: [embed] });
    }

    // No game specified — show a condensed one-line-per-game summary rather
    // than the full detailed breakdown, which wouldn't scale to a server
    // with many game groups.
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
      const topCaller  = Object.entries(data.callers).sort((a, b) => b[1] - a[1])[0];
      const lastPlayed = data.lastSession ? `<t:${Math.floor(data.lastSession / 1000)}:R>` : 'N/A';
      embed.addFields({
        name:   `🎮 ${game}`,
        value:  `Sessions: **${data.count}** | Top organiser: **${topCaller ? topCaller[0] : 'N/A'}** | Last played: ${lastPlayed}`,
        inline: false
      });
    }

    return interaction.editReply({ embeds: [embed] });
  }
};