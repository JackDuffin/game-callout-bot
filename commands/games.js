const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('games')
    .setDescription('List all available game groups'),

  async execute(interaction) {
    const guild = interaction.guild;
    const managedRoles = guild.roles.cache.filter(r =>
      r.name !== '@everyone' && !r.managed
    );

    if (managedRoles.size === 0) {
      return interaction.reply({ content: 'No game groups exist yet. Use /addgame to create one!', flags: 64 });
    }

    const list = managedRoles.map(r => `• ${r.name} (${r.members.size} members)`).join('\n');
    await interaction.reply({ content: `🎮 **Available game groups:**\n${list}`, flags: 64 });
  }
};