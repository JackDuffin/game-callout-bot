const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('addgame')
    .setDescription('Add an official game group (Admin only)')
    .addStringOption(opt =>
      opt.setName('name')
        .setDescription('Name of the game e.g. Minecraft')
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const gameName = interaction.options.getString('name');
    const guild = interaction.guild;

    // Game groups ARE Discord roles — there's no separate concept of a
    // "game" in the data model, the role IS the group. Duplicate names are
    // blocked here since /join, /callout etc. all resolve games by matching
    // role name, so two roles with the same name would be ambiguous.
    const existing = guild.roles.cache.find(r => r.name.toLowerCase() === gameName.toLowerCase());
    if (existing) {
      return interaction.reply({ content: `❌ A game group called **${existing.name}** already exists.`, flags: 64 });
    }

    // No colour/permissions set — this role exists purely to be a target
    // for role-based mentions and membership checks, not for anything
    // Discord-permission related.
    await guild.roles.create({
      name: gameName,
      reason: `Game group created by admin ${interaction.user.tag}`,
    });

    await interaction.reply({ content: `✅ Game group **${gameName}** created! Members can now join it with /join.` });
  }
};