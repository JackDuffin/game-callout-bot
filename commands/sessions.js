const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getSessions } = require('../utils/sessionStore');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sessions')
    .setDescription('View all upcoming scheduled sessions')
    .addStringOption(opt =>
      opt.setName('game')
        .setDescription('Filter by game (leave blank for all)')
        .setRequired(false)
        .setAutocomplete(true)),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const guild   = interaction.guild;
    const roles   = guild.roles.cache
      .filter(r => r.name !== '@everyone' && !r.managed)
      .map(r => r.name);

    const filtered = roles.filter(name => name.toLowerCase().includes(focused)).slice(0, 25);
    await interaction.respond(filtered.map(name => ({ name, value: name })));
  },

  async execute(interaction) {
    const gameName = interaction.options.getString('game')?.toLowerCase() || null;
    let upcoming   = getSessions(interaction.guildId);

    if (gameName) {
      upcoming = upcoming.filter(s => s.game.toLowerCase() === gameName);
    }

    if (upcoming.length === 0) {
      return interaction.reply({
        content: gameName
          ? `📭 No upcoming sessions for **${gameName}**. Use /schedule to set one up!`
          : '📭 No sessions scheduled yet. Use /schedule to set one up!',
        flags: 64
      });
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(`📅 Upcoming Sessions${gameName ? ` — ${gameName}` : ''}`)
      .setTimestamp();

    for (const s of upcoming) {
      const ts     = Math.floor(s.time / 1000);
      const capStr = s.cap !== null
        ? `${s.rsvpYes.length}/${s.cap} going`
        : `✅ ${s.rsvpYes.length} going`;

      embed.addFields({
        name:   `🎮 ${s.game}`,
        value:  `<t:${ts}:F> (<t:${ts}:R>)\nCalled by: ${s.callerTag} | ${capStr}`,
        inline: false
      });
    }

    await interaction.reply({ embeds: [embed], flags: 64 });
  }
};