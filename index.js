require('dotenv').config();
const { Client, GatewayIntentBits, Collection, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const { readSessions, removeExpiredSessions, getSessions, cancelSession, updateSession } = require('./utils/sessionStore');
const { scheduleTimers } = require('./commands/schedule');

// Initialise database on startup
require('./utils/db');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
  ]
});

client.commands = new Collection();
client.rsvpSessions = {};
client.pendingEdits = {};

const commandFiles = fs.readdirSync('./commands').filter(f => f.endsWith('.js'));
for (const file of commandFiles) {
  const command = require(`./commands/${file}`);
  client.commands.set(command.data.name, command);
}

client.once('clientReady', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  removeExpiredSessions();

  const guild = client.guilds.cache.first();
  const sessions = readSessions(guild.id);
  const now = Date.now();

  for (const session of sessions) {
    if (session.cancelled || session.time <= now) continue;

    try {
      const channel = await client.channels.fetch(session.channelId);
      const role = guild.roles.cache.find(r => r.name.toLowerCase() === session.game.toLowerCase());

      if (!channel || !role) continue;

      client.rsvpSessions[session.id] = {
        rsvpYes: session.rsvpYes || [],
        rsvpNo: session.rsvpNo || [],
        message: null,
        role,
        sessionTime: session.time,
        extraMessage: session.extraMessage || '',
        timers: null
      };

      const timers = scheduleTimers(client, session.id, session.time, role, channel);
      client.rsvpSessions[session.id].timers = timers;

      console.log(`🔁 Restored timer for ${session.game} session at ${new Date(session.time).toLocaleString()}`);
    } catch (err) {
      console.error(`Failed to restore session ${session.id}:`, err.message);
    }
  }
});

client.on('error', error => {
  console.error('Client error:', error);
});

process.on('unhandledRejection', error => {
  console.error('Unhandled promise rejection:', error);
});

client.on('interactionCreate', async interaction => {

  // Handle cancel select menu
  if (interaction.isStringSelectMenu() && interaction.customId === 'cancel_select') {
    const sessionId = interaction.values[0];
    const sessions = getSessions(interaction.guildId);
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

    if (liveSession?.timers) {
      clearTimeout(liveSession.timers.reminderTimer);
      clearTimeout(liveSession.timers.startTimer);
    }

    delete interaction.client.rsvpSessions?.[sessionId];

    await interaction.update({
      content: `✅ The **${session.game}** session scheduled for <t:${Math.floor(session.time / 1000)}:F> has been cancelled.`,
      components: []
    });
    return;
  }

  // Handle edit select menu
  if (interaction.isStringSelectMenu() && interaction.customId === 'edit_select') {
    const sessionId = interaction.values[0];
    const sessions = getSessions(interaction.guildId);
    const session = sessions.find(s => s.id === sessionId);

    if (!session) {
      return interaction.update({ content: '❌ Session not found — it may have already ended or been cancelled.', components: [] });
    }

    const pendingEdit = interaction.client.pendingEdits?.[interaction.user.id];
    if (!pendingEdit) {
      return interaction.update({ content: '❌ Edit details expired — please run `/editschedule` again.', components: [] });
    }

    delete interaction.client.pendingEdits[interaction.user.id];

    await interaction.update({ content: 'Applying edit...', components: [] });

    const { applyEdit } = require('./commands/editschedule');
    await applyEdit(interaction, session, pendingEdit.newTimeInput, pendingEdit.newMessage, true);
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

      // Persist RSVP update to database
      updateSession(sessionId, {
        rsvpYes: session.rsvpYes,
        rsvpNo: session.rsvpNo
      });

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