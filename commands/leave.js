const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Leave a game group')
    .addStringOption(opt =>
      opt.setName('game')
        .setDescription('The game you want to leave')
        .setRequired(true)),

  async execute(interaction) {
    const guild = interaction.guild;
    const member = interaction.member;

    const memberRoles = member.roles.cache.filter(r => r.name !== '@everyone' && !r.managed);

    if (memberRoles.size === 0) {
      return interaction.reply({ content: `❌ You aren't in any game groups.`, flags: 64 });
    }

    const input = interaction.options.getString('game').toLowerCase();
    const role = memberRoles.find(r => r.name.toLowerCase() === input || r.id === input);

    if (!role) {
      const list = memberRoles.map(r => `• ${r.name}`).join('\n');
      return interaction.reply({ content: `❌ You aren't in **${input}**. Your current groups:\n${list}`, flags: 64 });
    }

    await member.roles.remove(role);
    await interaction.reply({ content: `✅ You've left **${role.name}**.`, flags: 64 });
  }
};