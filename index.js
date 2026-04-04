require('dotenv').config();
const { Client, GatewayIntentBits, Collection, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const { readSessions, removeExpiredSessions, getSessions, cancelSession } = require('./utils/sessionStore');
const { scheduleTimers } = require('./commands/schedule');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
  ]
});

client.commands = new Collection();
client.rsvpSessions = {};

const commandFiles = fs.readdirSync('./commands').filter(f => f.endsWith('.js'));
for (const file of commandFiles) {
  const command = require(`./commands/${file}`);
  client.commands.set(command.data.name, command);
}

client.once('clientReady', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  removeExpiredSessions();

  const sessions = readSessions();
  const now = Date.now();

  for (const session of sessions) {
    if (session.cancelled || session.time <= now) continue;

    try {
      const guild = client.guilds.cache.first();
      const channel = await client.channels.fetch(session.channelId);
      const role = guild.roles.cache.find(r => r.name.toLowerCase() === session.game.toLowerCase());

      if (!channel || !role) continue;

      client.rsvpSessions[session.id] = {
        rsvpYes: session.rsvpYes || [],
        rsvpNo: session.rsvpNo || [],
        message: null,
        role,
        sessionTime: session.time
      };

      scheduleTimers(client, session.id, session.time, role, channel);
      console.log(`🔁 Restored timer for ${session.game} session at ${new Date(session.time).toLocaleString()}`);
    } catch (err) {
      console.error(`Failed to restore session ${session.id}:`, err.message);
    }
  }
});

client.on('interactionCreate', async interaction => {

  // Handle cancel select menu
  if (interaction.isStringSelectMenu() && interaction.customId === 'cancel_select') {
    const sessionId = interaction.values[0];
    const sessions = getSessions();
    const session = sessions.find(s => s.id === sessionId);

    if (!session) {
      return interaction.reply({ content: '❌ Session not found — it may have already been cancelled.', flags: 64 });
    }

    if (session.callerTag !== interaction.user.tag) {
      return interaction.reply({ content: '❌ You can only cancel sessions you scheduled.', flags: 64 });
    }

    cancelSession(sessionId);

    const liveSession = interaction.client.rsvpSessions?.[sessionId];
    if (liveSession?.message) {
      try {
        await liveSession.message.edit({ components: [] });
      } catch {
        // Message may have been deleted
      }
    }

    delete interaction.client.rsvpSessions?.[sessionId];

    await interaction.update({
      content: `✅ The **${session.game}** session scheduled for <t:${Math.floor(session.time / 1000)}:F> has been cancelled.`,
      components: []
    });
    return;
  }

  // Handle RSVP buttons
  if (interaction.isButton()) {
    const customId = interaction.customId;
    const isYes = customId.startsWith('rsvp_yes_');
    const isNo = customId.startsWith('rsvp_no_');

    if (isYes || isNo) {
      const sessionId = customId.replace('rsvp_yes_', '').replace('rsvp_no_', '');
      const session = client.rsvpSessions[sessionId];

      if (!session) {
        return interaction.reply({ content: '❌ Session not found — it may have expired or been cancelled.', flags: 64 });
      }

      const userMention = interaction.user.toString();
      session.rsvpYes = session.rsvpYes.filter(u => u !== userMention);
      session.rsvpNo = session.rsvpNo.filter(u => u !== userMention);

      if (isYes) session.rsvpYes.push(userMention);
      else session.rsvpNo.push(userMention);

      const oldEmbed = interaction.message.embeds[0];
      const updated = EmbedBuilder.from(oldEmbed)
        .spliceFields(2, 1, {
          name: '✅ Going',
          value: session.rsvpYes.length > 0 ? session.rsvpYes.join('\n') : 'Nobody yet',
          inline: true
        })
        .spliceFields(3, 1, {
          name: '❌ Not going',
          value: session.rsvpNo.length > 0 ? session.rsvpNo.join('\n') : 'Nobody yet',
          inline: true
        });

      await interaction.update({ embeds: [updated] });
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  console.log(`Command received: ${interaction.commandName}`);

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error('Command error:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'Something went wrong!', flags: 64 });
    }
  }
});

client.login(process.env.TOKEN);