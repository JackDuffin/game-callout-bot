const { SlashCommandBuilder } = require('discord.js');
const { setTimezone, getTimezone } = require('../utils/sessionStore');
const { isValidTimezone } = require('../utils/timezone');

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

    // No argument — show current timezone rather than requiring the member
    // to re-type a value just to check what's already set.
    if (!tz) {
      const current = getTimezone(interaction.guildId, interaction.user.id);
      const serverTz = getTimezone(interaction.guildId);
      // getTimezone falls back to the server default when no personal
      // override exists, so comparing the two tells us which one applies
      // without needing a separate "has override" flag.
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

    // Passing the user's id (vs null in /settimezone) is what makes this a
    // personal override rather than the server-wide default.
    setTimezone(interaction.guildId, tz, interaction.user.id);

    await interaction.reply({
      content: `✅ Your personal timezone has been set to **${tz}**. Session times you schedule will be interpreted in this timezone.`,
      flags: 64
    });
  }
};