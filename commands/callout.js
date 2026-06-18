const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../utils/db');

const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

module.exports = {
  data: new SlashCommandBuilder()
    .setName('callout')
    .setDescription('Ping all members of a game group')
    .addStringOption(opt =>
      opt.setName('game')
        .setDescription('Which game group to ping')
        .setRequired(true)
        .setAutocomplete(true))
    .addStringOption(opt =>
      opt.setName('message')
        .setDescription('Optional message to include')
        .setRequired(false)),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();

    const roles = interaction.member.roles.cache
      .filter(r => r.name !== '@everyone' && !r.managed)
      .map(r => r.name);

    const filtered = roles.filter(name => name.toLowerCase().includes(focused)).slice(0, 25);
    await interaction.respond(filtered.map(name => ({ name, value: name })));
  },

  async execute(interaction) {
    const guild        = interaction.guild;
    const input        = interaction.options.getString('game').toLowerCase();
    const extraMessage = interaction.options.getString('message') || '';

    const gameRoles = guild.roles.cache.filter(r => r.name !== '@everyone' && !r.managed);
    const role      = gameRoles.find(r => r.name.toLowerCase() === input || r.id === input);

    if (!role) {
      const list = gameRoles.map(r => `• ${r.name}`).join('\n');
      return interaction.reply({ content: `❌ No game group called **${input}**. Available groups:\n${list}`, flags: 64 });
    }

    if (!interaction.member.roles.cache.has(role.id)) {
      return interaction.reply({ content: `❌ You need to be in **${role.name}** to call out its members.`, flags: 64 });
    }

    // Cooldown check
    const now = Date.now();
    const row = db.prepare('SELECT lastAt FROM callout_cooldowns WHERE guildId = ? AND game = ?')
      .get(interaction.guildId, role.name.toLowerCase());

    if (row) {
      const elapsed = now - row.lastAt;
      if (elapsed < COOLDOWN_MS) {
        const remaining = Math.ceil((COOLDOWN_MS - elapsed) / 60_000);
        return interaction.reply({
          content: `⏳ **${role.name}** was already called out recently. Try again in **${remaining} minute${remaining === 1 ? '' : 's'}**.`,
          flags: 64
        });
      }
    }

    // Record the callout
    db.prepare(`
      INSERT INTO callout_cooldowns (guildId, game, lastAt)
      VALUES (?, ?, ?)
      ON CONFLICT(guildId, game) DO UPDATE SET lastAt = ?
    `).run(interaction.guildId, role.name.toLowerCase(), now, now);

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(`🎮 ${role.name} — hop on!`)
      .addFields({ name: '📣 Called by', value: interaction.user.toString(), inline: true })
      .setTimestamp();

    if (extraMessage) {
      embed.setDescription(extraMessage);
    }

    await interaction.reply({
      content:         `${role}`,
      embeds:          [embed],
      allowedMentions: { roles: [role.id] }
    });
  }
};