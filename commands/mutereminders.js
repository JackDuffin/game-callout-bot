const { SlashCommandBuilder } = require('discord.js');
const { muteGame, isMuted } = require('../utils/sessionStore');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mutereminders')
    .setDescription('Stop receiving reminder pings for a game')
    .addStringOption(opt =>
      opt.setName('game')
        .setDescription('The game to mute reminders for')
        .setRequired(true)
        .setAutocomplete(true)),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    // Only games the member is in — reminders only apply to groups you
    // belong to in the first place.
    const roles   = interaction.member.roles.cache
      .filter(r => r.name !== '@everyone' && !r.managed)
      .map(r => r.name);

    const filtered = roles.filter(name => name.toLowerCase().includes(focused)).slice(0, 25);
    await interaction.respond(filtered.map(name => ({ name, value: name })));
  },

  async execute(interaction) {
    const gameName = interaction.options.getString('game');
    const guild    = interaction.guild;
    // Exact match only here (no id fallback like /join etc.) — the game
    // name always comes from autocomplete for this command, never a
    // freeform id paste, so a stricter match is fine.
    const role     = guild.roles.cache.find(r =>
      r.name !== '@everyone' && !r.managed && r.name.toLowerCase() === gameName.toLowerCase()
    );

    if (!role) {
      return interaction.reply({ content: `❌ No game group called **${gameName}** exists.`, flags: 64 });
    }

    if (!interaction.member.roles.cache.has(role.id)) {
      return interaction.reply({ content: `❌ You're not in **${role.name}**.`, flags: 64 });
    }

    // Mutes only affect the 30-minute/start reminder pings — the initial
    // session announcement still role-pings everyone, muted or not, since
    // that's the actual "a session was scheduled" notification.
    if (isMuted(interaction.guildId, interaction.user.id, role.name)) {
      return interaction.reply({ content: `🔇 You already have reminders muted for **${role.name}**.`, flags: 64 });
    }

    muteGame(interaction.guildId, interaction.user.id, role.name);

    await interaction.reply({
      content: `🔇 Reminders muted for **${role.name}**. You won't be mentioned in the 30-minute or session-start pings. Use \`/unmutereminders\` to turn them back on.`,
      flags: 64
    });
  }
};