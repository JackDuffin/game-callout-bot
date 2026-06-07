const { SlashCommandBuilder } = require('discord.js');

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

    // Only show games the user is a member of
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

    const message = `🎮 **${role.name} session starting!** ${extraMessage}\n${role} — hop on!`;
    await interaction.reply({ content: message, allowedMentions: { roles: [role.id] } });
  }
};