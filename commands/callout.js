const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('callout')
    .setDescription('Ping all members of a game group')
    .addStringOption(opt =>
      opt.setName('game')
        .setDescription('Which game group to ping')
        .setRequired(true))
    .addStringOption(opt =>
      opt.setName('message')
        .setDescription('Optional message to include')
        .setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply();

    const guild = interaction.guild;
    const input = interaction.options.getString('game').toLowerCase();
    const extraMessage = interaction.options.getString('message') || '';

    const gameRoles = guild.roles.cache.filter(r => r.name !== '@everyone' && !r.managed);
    const role = gameRoles.find(r => r.name.toLowerCase() === input || r.id === input);

    if (!role) {
      const list = gameRoles.map(r => `• ${r.name}`).join('\n');
      return interaction.editReply({ content: `❌ No game group called **${input}**. Available groups:\n${list}` });
    }

    if (!interaction.member.roles.cache.has(role.id)) {
      return interaction.editReply({ content: `❌ You need to be in **${role.name}** to call out its members.` });
    }

    const message = `🎮 **${role.name} session starting!** ${extraMessage}\n${role} — hop on!`;
    await interaction.editReply({ content: message, allowedMentions: { roles: [role.id] } });
  }
};