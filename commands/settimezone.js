const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { setTimezone, getTimezone } = require('../utils/sessionStore');

function isValidTimezone(tz) {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('settimezone')
    .setDescription('Set the server timezone for session scheduling (Admin only)')
    .addStringOption(opt =>
      opt.setName('timezone')
        .setDescription('IANA timezone e.g. Europe/Dublin, America/New_York, Asia/Tokyo')
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const tz = interaction.options.getString('timezone');

    if (!isValidTimezone(tz)) {
      return interaction.reply({
        content: `❌ **${tz}** isn't a valid timezone. Use an IANA timezone name like \`Europe/Dublin\`, \`America/New_York\`, or \`Asia/Tokyo\`.\nFull list: <https://en.wikipedia.org/wiki/List_of_tz_database_time_zones>`,
        flags: 64
      });
    }

    setTimezone(interaction.guildId, tz, null);

    await interaction.reply({
      content: `✅ Server timezone set to **${tz}**. Session times will now be interpreted in this timezone.`
    });
  }
};