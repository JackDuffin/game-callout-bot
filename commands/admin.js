const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { getSessions, getTimezone } = require('../utils/sessionStore');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('admin')
    .setDescription('View the server dashboard (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });

    const guild    = interaction.guild;
    const guildId  = interaction.guildId;
    const timezone = getTimezone(guildId);
    const upcoming = getSessions(guildId);

    const gameRoles = guild.roles.cache
      .filter(r => r.name !== '@everyone' && !r.managed)
      .sort((a, b) => a.name.localeCompare(b.name));

    let groupLines = '';
    if (gameRoles.size === 0) {
      groupLines = '_No game groups yet. Use `/addgame` to create one._';
    } else {
      for (const [, role] of gameRoles) {
        const sessionsForGame = upcoming.filter(s => s.game === role.name.toLowerCase());
        const nextSession     = sessionsForGame.length > 0
          ? ` — next: <t:${Math.floor(sessionsForGame[0].time / 1000)}:R>`
          : '';
        groupLines += `• **${role.name}** (${role.members.size} member${role.members.size === 1 ? '' : 's'})${nextSession}\n`;
      }
    }

    let sessionLines = '';
    if (upcoming.length === 0) {
      sessionLines = '_No sessions scheduled._';
    } else {
      for (const s of upcoming) {
        const capStr = s.cap !== null ? `${s.rsvpYes.length}/${s.cap}` : `${s.rsvpYes.length} going`;
        const ts     = Math.floor(s.time / 1000);
        sessionLines += `• **${s.game}** — <t:${ts}:F> (<t:${ts}:R>) | ${capStr} | by ${s.callerTag}\n`;
      }
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(`⚙️ Admin Dashboard — ${guild.name}`)
      .addFields(
        { name: '🌍 Server Timezone',                     value: `\`${timezone}\``,       inline: false },
        { name: `🎮 Game Groups (${gameRoles.size})`,     value: groupLines || '_None_',  inline: false },
        { name: `📅 Upcoming Sessions (${upcoming.length})`, value: sessionLines || '_None_', inline: false }
      )
      .setFooter({ text: 'Use /addgame, /removegame, and /settimezone to manage the server' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }
};