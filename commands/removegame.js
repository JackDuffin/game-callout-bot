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

    // No autocomplete on this option — deletion is destructive enough that
    // requiring the admin to type the exact name is a small extra safety
    // check against fat-fingering a similarly-named role.
    const role = guild.roles.cache.find(r => r.name.toLowerCase() === gameName.toLowerCase());
    if (!role) {
      return interaction.reply({ content: `❌ No game group called **${gameName}** exists.`, flags: 64 });
    }

    // Deleting the role is the entire operation — there's no separate
    // "game" record anywhere else to clean up (see addgame.js: the role IS
    // the game group). Existing sessions/history/stats for this game are
    // left untouched in the DB, so past data isn't lost even after removal.
    await role.delete(`Game group removed by admin ${interaction.user.tag}`);
    await interaction.reply({ content: `✅ Game group **${gameName}** has been removed.` });
  }
};