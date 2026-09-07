// Shared cleanup for cancelling a live session: removes the RSVP buttons from
// the embed, clears both timers, and removes the entry from rsvpSessions.
// Called from both cancelsession.js and the cancel_select handler in index.js.
async function cleanupLiveSession(client, sessionId) {
  const liveSession = client.rsvpSessions?.[sessionId];
  if (!liveSession) return;

  if (liveSession.message) {
    try { await liveSession.message.edit({ components: [] }); } catch {}
  }
  if (liveSession.timers) {
    clearTimeout(liveSession.timers.reminderTimer);
    clearTimeout(liveSession.timers.startTimer);
  }
  delete client.rsvpSessions[sessionId];
}

module.exports = { cleanupLiveSession };