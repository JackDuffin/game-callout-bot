const { SlashCommandBuilder } = require('discord.js');
const { unmuteGame, isMuted } = require('../utils/sessionStore');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unmutereminders')
    .setDescription('Resume receiving reminder pings for a game')
    .addStringOption(opt =>
      opt.setName('game')
        .setDescription('The game to unmute reminders for')
        .setRequired(true)
        .setAutocomplete(true)),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const roles   = interaction.member.roles.cache
      .filter(r => r.name !== '@everyone' && !r.managed)
      .map(r => r.name);

    const filtered = roles.filter(name => name.toLowerCase().includes(focused)).slice(0, 25);
    await interaction.respond(filtered.map(name => ({ name, value: name })));
  },

  async execute(interaction) {
    const gameName = interaction.options.getString('game');
    const guild    = interaction.guild;
    const role     = guild.roles.cache.find(r =>
      r.name !== '@everyone' && !r.managed && r.name.toLowerCase() === gameName.toLowerCase()
    );

    if (!role) {
      return interaction.reply({ content: `❌ No game group called **${gameName}** exists.`, flags: 64 });
    }

    if (!interaction.member.roles.cache.has(role.id)) {
      return interaction.reply({ content: `❌ You're not in **${role.name}**.`, flags: 64 });
    }

    if (!isMuted(interaction.guildId, interaction.user.id, role.name)) {
      return interaction.reply({ content: `🔔 Your reminders for **${role.name}** are already on.`, flags: 64 });
    }

    unmuteGame(interaction.guildId, interaction.user.id, role.name);

    await interaction.reply({
      content: `🔔 Reminders turned back on for **${role.name}**. You'll be mentioned in the 30-minute and session-start pings again.`,
      flags: 64
    });
  }
};