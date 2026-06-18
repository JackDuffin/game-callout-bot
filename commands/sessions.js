const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getSessions } = require('../utils/sessionStore');

const PAGE_SIZE = 10;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sessions')
    .setDescription('View all upcoming scheduled sessions')
    .addStringOption(opt =>
      opt.setName('game')
        .setDescription('Filter by game (leave blank for all)')
        .setRequired(false)
        .setAutocomplete(true))
    .addIntegerOption(opt =>
      opt.setName('page')
        .setDescription('Page number (default: 1)')
        .setRequired(false)
        .setMinValue(1)),

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
    await interaction.deferReply({ flags: 64 });

    const gameName = interaction.options.getString('game')?.toLowerCase() || null;
    const page     = interaction.options.getInteger('page') || 1;
    const guildId  = interaction.guildId;

    let upcoming = getSessions(guildId);
    if (gameName) upcoming = upcoming.filter(s => s.game.toLowerCase() === gameName);

    const total      = upcoming.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    if (total === 0) {
      return interaction.editReply({
        content: gameName
          ? `📭 No upcoming sessions for **${gameName}**. Use /schedule to set one up!`
          : '📭 No sessions scheduled yet. Use /schedule to set one up!'
      });
    }

    if (page > totalPages) {
      return interaction.editReply({
        content: `❌ Page ${page} doesn't exist — there are only ${totalPages} page${totalPages === 1 ? '' : 's'}.`
      });
    }

    const offset   = (page - 1) * PAGE_SIZE;
    const pageItems = upcoming.slice(offset, offset + PAGE_SIZE);

    const embed = buildSessionsEmbed(pageItems, gameName, page, totalPages, total);
    const row   = buildPaginationRow(gameName, page, totalPages);

    await interaction.editReply({
      embeds:     [embed],
      components: row ? [row] : []
    });
  }
};

function buildSessionsEmbed(sessions, gameName, page, totalPages, total) {
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`📅 Upcoming Sessions${gameName ? ` — ${gameName}` : ''}`)
    .setFooter({ text: `Page ${page} of ${totalPages} · ${total} session${total === 1 ? '' : 's'} total` })
    .setTimestamp();

  for (const s of sessions) {
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

  return embed;
}

function buildPaginationRow(gameName, page, totalPages) {
  if (totalPages <= 1) return null;

  const gameStr = gameName || '';

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`sessions_prev_${page}_${gameStr}`)
      .setLabel('◀ Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 1),
    new ButtonBuilder()
      .setCustomId(`sessions_next_${page}_${gameStr}`)
      .setLabel('Next ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages)
  );
}

module.exports.buildSessionsEmbed = buildSessionsEmbed;
module.exports.buildPaginationRow = buildPaginationRow;