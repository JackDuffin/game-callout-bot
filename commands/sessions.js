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
    // Not restricted to the member's own games — like /history, upcoming
    // sessions are server-wide info anyone can browse.
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

    // getSessions() already excludes cancelled and past sessions — only an
    // optional game filter needs applying here in-memory.
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

    // Guard against requesting a page beyond what exists.
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
      // Omit the row entirely on a single page rather than showing disabled
      // Previous/Next buttons with nothing to page through.
      components: row ? [row] : []
    });
  }
};

// Shared between the initial /sessions reply and the sessions_prev_/next_
// button handler in index.js, so paging looks identical to the first page.
function buildSessionsEmbed(sessions, gameName, page, totalPages, total) {
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`📅 Upcoming Sessions${gameName ? ` — ${gameName}` : ''}`)
    .setFooter({ text: `Page ${page} of ${totalPages} · ${total} session${total === 1 ? '' : 's'} total` })
    .setTimestamp();

  for (const s of sessions) {
    const ts     = Math.floor(s.time / 1000);
    // "going" rather than history's "went" — these are still upcoming, so
    // the RSVP count is a live headcount, not a historical record.
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

// Returns null when there's nothing to paginate, letting callers skip
// attaching a components row entirely.
function buildPaginationRow(gameName, page, totalPages) {
  if (totalPages <= 1) return null;

  // customId encodes page/filter state directly since button interactions
  // carry no other context — parsed back out in the index.js handler.
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