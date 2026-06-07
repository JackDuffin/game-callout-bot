const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('join')
    .setDescription('Join a game group to receive callouts')
    .addStringOption(opt =>
      opt.setName('game')
        .setDescription('The game you want to join e.g. Minecraft')
        .setRequired(true)
        .setAutocomplete(true)),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const guild   = interaction.guild;

    // Only show games the user hasn't already joined
    const roles = guild.roles.cache
      .filter(r => r.name !== '@everyone' && !r.managed && !interaction.member.roles.cache.has(r.id))
      .map(r => r.name);

    const filtered = roles.filter(name => name.toLowerCase().includes(focused)).slice(0, 25);
    await interaction.respond(filtered.map(name => ({ name, value: name })));
  },

  async execute(interaction) {
    const guild     = interaction.guild;
    const gameRoles = guild.roles.cache.filter(r => r.name !== '@everyone' && !r.managed);

    if (gameRoles.size === 0) {
      return interaction.reply({ content: '❌ No game groups exist yet. Ask an admin to add one with /addgame.', flags: 64 });
    }

    const input = interaction.options.getString('game').toLowerCase();
    const role  = gameRoles.find(r => r.name.toLowerCase() === input || r.id === input);

    if (!role) {
      const list = gameRoles.map(r => `• ${r.name}`).join('\n');
      return interaction.reply({ content: `❌ **${input}** isn't a valid game group. Available groups:\n${list}`, flags: 64 });
    }

    if (interaction.member.roles.cache.has(role.id)) {
      return interaction.reply({ content: `You're already in **${role.name}**!`, flags: 64 });
    }

    await interaction.member.roles.add(role);
    await interaction.reply({ content: `✅ You've joined **${role.name}**! You'll now receive callouts for this game.`, flags: 64 });
  }
};