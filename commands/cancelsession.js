const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { getSessions, cancelSession } = require('../utils/sessionStore');
const { cleanupLiveSession } = require('../utils/cancelHelper');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cancelsession')
    .setDescription('Cancel a session you scheduled')
    .addStringOption(opt =>
      opt.setName('game')
        .setDescription('The game session to cancel')
        .setRequired(true)
        .setAutocomplete(true)),

  async autocomplete(interaction) {
    const focused      = interaction.options.getFocused().toLowerCase();
    const sessions     = getSessions(interaction.guildId);

    // Only show games the user has scheduled sessions for — cancellation is
    // restricted to whoever originally scheduled it, so anything else would
    // just be a suggestion the member can't act on anyway.
    const userGames = [...new Set(
      sessions
        .filter(s => s.callerTag === interaction.user.tag)
        .map(s => s.game)
    )];

    const filtered = userGames
      .filter(name => name.toLowerCase().includes(focused))
      .slice(0, 25);

    await interaction.respond(filtered.map(name => ({ name, value: name })));
  },

  async execute(interaction) {
    const input    = interaction.options.getString('game').toLowerCase();
    const sessions = getSessions(interaction.guildId);

    // Scoped to sessions this member scheduled — same ownership rule as
    // /editschedule, so one member can't cancel another's session.
    const userSessions = sessions.filter(s =>
      s.game.toLowerCase() === input &&
      s.callerTag === interaction.user.tag
    );

    if (userSessions.length === 0) {
      // Distinguish "no session for this game" from "a session exists but
      // you didn't schedule it" — gives a clearer error than a flat
      // "not found" when the game itself is valid.
      const allForGame = sessions.filter(s => s.game.toLowerCase() === input);
      if (allForGame.length > 0) {
        return interaction.reply({ content: `❌ You didn't schedule any upcoming **${input}** sessions — only the person who scheduled it can cancel it.`, flags: 64 });
      }
      return interaction.reply({ content: `❌ No upcoming session found for **${input}**.`, flags: 64 });
    }

    if (userSessions.length === 1) {
      const session = userSessions[0];

      // Marks the session cancelled in the DB (also rolls back stats/caller
      // counts) — this is separate from, and always runs regardless of,
      // whether a live in-memory session still exists to clean up below.
      cancelSession(session.id);

      // Handles the in-memory side: stripping the RSVP buttons from the
      // posted message, clearing both timers, and removing the rsvpSessions
      // entry. Shared with the cancel_select handler in index.js so both
      // cancellation paths behave identically.
      await cleanupLiveSession(interaction.client, session.id);

      return interaction.reply({
        content: `✅ The **${session.game}** session scheduled for <t:${Math.floor(session.time / 1000)}:F> has been cancelled.`
      });
    }

    // Multiple sessions for this game — show a select menu rather than
    // guessing which one the member meant.
    const options = userSessions
      .sort((a, b) => a.time - b.time)
      .map(s => ({
        label:       `${s.game} — ${new Date(s.time).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}`,
        description: new Date(s.time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }),
        value:       s.id
      }));

    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('cancel_select')
        .setPlaceholder('Pick the session to cancel')
        .addOptions(options)
    );

    await interaction.reply({
      content:    `You have **${userSessions.length}** upcoming ${input} sessions — which one do you want to cancel?`,
      components: [row],
      flags:      64
    });
  }
};