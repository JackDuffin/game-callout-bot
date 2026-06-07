const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getHistory, getHistoryCount } = require('../utils/sessionStore');

const PAGE_SIZE = 10;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('history')
    .setDescription('View past sessions')
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
    const focused  = interaction.options.getFocused().toLowerCase();
    const guild    = interaction.guild;
    const roles    = guild.roles.cache
      .filter(r => r.name !== '@everyone' && !r.managed)
      .map(r => r.name);

    const filtered = roles.filter(name => name.toLowerCase().includes(focused)).slice(0, 25);
    await interaction.respond(filtered.map(name => ({ name, value: name })));
  },

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });

    const gameName   = interaction.options.getString('game') || null;
    const page       = interaction.options.getInteger('page') || 1;
    const guildId    = interaction.guildId;
    const total      = getHistoryCount(guildId, gameName);
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    if (total === 0) {
      return interaction.editReply({
        content: gameName
          ? `📭 No past sessions found for **${gameName}**.`
          : '📭 No past sessions found yet.'
      });
    }

    if (page > totalPages) {
      return interaction.editReply({ content: `❌ Page ${page} doesn't exist — there are only ${totalPages} page${totalPages === 1 ? '' : 's'}.` });
    }

    const offset   = (page - 1) * PAGE_SIZE;
    const sessions = getHistory(guildId, gameName, PAGE_SIZE, offset);
    const embed    = buildHistoryEmbed(sessions, gameName, page, totalPages, total);
    const row      = buildPaginationRow(gameName, page, totalPages);

    await interaction.editReply({
      embeds:     [embed],
      components: row ? [row] : []
    });
  }
};

function buildHistoryEmbed(sessions, gameName, page, totalPages, total) {
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`📜 Session History${gameName ? ` — ${gameName}` : ''}`)
    .setFooter({ text: `Page ${page} of ${totalPages} · ${total} session${total === 1 ? '' : 's'} total` })
    .setTimestamp();

  for (const s of sessions) {
    const ts       = Math.floor(s.time / 1000);
    const yesCount = s.rsvpYes.length;
    const capStr   = s.cap !== null ? `${yesCount}/${s.cap}` : `${yesCount} went`;
    embed.addFields({
      name:   `🎮 ${s.game} — <t:${ts}:D>`,
      value:  `<t:${ts}:t> · ${capStr} · by ${s.callerTag}`,
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
      .setCustomId(`history_prev_${page}_${gameStr}`)
      .setLabel('◀ Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 1),
    new ButtonBuilder()
      .setCustomId(`history_next_${page}_${gameStr}`)
      .setLabel('Next ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages)
  );
}

module.exports.buildHistoryEmbed  = buildHistoryEmbed;
module.exports.buildPaginationRow = buildPaginationRow;