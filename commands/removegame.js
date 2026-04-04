const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('removegame')
    .setDescription('Remove an official game group (Admin only)')
    .addStringOption(opt =>
      opt.setName('name')
        .setDescription('Name of the game to remove')
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const gameName = interaction.options.getString('name');
    const guild = interaction.guild;

    const role = guild.roles.cache.find(r => r.name.toLowerCase() === gameName.toLowerCase());
    if (!role) {
      return interaction.reply({ content: `❌ No game group called **${gameName}** exists.`, flags: 64 });
    }

    await role.delete(`Game group removed by admin ${interaction.user.tag}`);
    await interaction.reply({ content: `✅ Game group **${gameName}** has been removed.` });
  }
};