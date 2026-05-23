const { SlashCommandBuilder } = require('discord.js');
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
    .setName('mytimezone')
    .setDescription('Set your personal timezone for session scheduling')
    .addStringOption(opt =>
      opt.setName('timezone')
        .setDescription('IANA timezone e.g. Europe/Dublin, America/New_York, Asia/Tokyo')
        .setRequired(false)),

  async execute(interaction) {
    const tz = interaction.options.getString('timezone');

    // No argument — show current timezone
    if (!tz) {
      const current = getTimezone(interaction.guildId, interaction.user.id);
      const serverTz = getTimezone(interaction.guildId);
      const isPersonal = current !== serverTz;
      return interaction.reply({
        content: `🕐 Your timezone is currently **${current}**${isPersonal ? ' (personal)' : ' (server default)'}.`,
        flags: 64
      });
    }

    if (!isValidTimezone(tz)) {
      return interaction.reply({
        content: `❌ **${tz}** isn't a valid timezone. Use an IANA timezone name like \`Europe/Dublin\`, \`America/New_York\`, or \`Asia/Tokyo\`.\nFull list: <https://en.wikipedia.org/wiki/List_of_tz_database_time_zones>`,
        flags: 64
      });
    }

    setTimezone(interaction.guildId, tz, interaction.user.id);

    await interaction.reply({
      content: `✅ Your personal timezone has been set to **${tz}**. Session times you schedule will be interpreted in this timezone.`,
      flags: 64
    });
  }
};