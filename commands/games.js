const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('games')
    .setDescription('List all available game groups'),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });

    const guild = interaction.guild;
    // Note: despite the variable name, this is actually every game-group
    // role — i.e. roles that are NOT managed (managed roles are bot
    // integration roles, which are never game groups) and not @everyone.
    const managedRoles = guild.roles.cache.filter(r =>
      r.name !== '@everyone' && !r.managed
    );

    if (managedRoles.size === 0) {
      return interaction.editReply({ content: 'No game groups exist yet. Use /addgame to create one!' });
    }

    const list = managedRoles.map(r => `• ${r.name} (${r.members.size} members)`).join('\n');
    await interaction.editReply({ content: `🎮 **Available game groups:**\n${list}` });
  }
};