const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Leave a game group')
    .addStringOption(opt =>
      opt.setName('game')
        .setDescription('The game you want to leave')
        .setRequired(true)
        .setAutocomplete(true)),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();

    // Mirror image of /join's autocomplete — only games the member is
    // currently in are valid things to leave.
    const roles = interaction.member.roles.cache
      .filter(r => r.name !== '@everyone' && !r.managed)
      .map(r => r.name);

    const filtered = roles.filter(name => name.toLowerCase().includes(focused)).slice(0, 25);
    await interaction.respond(filtered.map(name => ({ name, value: name })));
  },

  async execute(interaction) {
    const member      = interaction.member;
    const memberRoles = member.roles.cache.filter(r => r.name !== '@everyone' && !r.managed);

    if (memberRoles.size === 0) {
      return interaction.reply({ content: `❌ You aren't in any game groups.`, flags: 64 });
    }

    const input = interaction.options.getString('game').toLowerCase();
    // Accept either the display name or a raw role id, same pattern used
    // across the other game-lookup commands.
    const role  = memberRoles.find(r => r.name.toLowerCase() === input || r.id === input);

    if (!role) {
      const list = memberRoles.map(r => `• ${r.name}`).join('\n');
      return interaction.reply({ content: `❌ You aren't in **${input}**. Your current groups:\n${list}`, flags: 64 });
    }

    await member.roles.remove(role);
    await interaction.reply({ content: `✅ You've left **${role.name}**.`, flags: 64 });
  }
};