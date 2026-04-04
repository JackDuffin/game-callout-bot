const fs = require('fs');
const path = require('path');

const sessionsPath = path.join(__dirname, '../data/sessions.json');
const statsPath = path.join(__dirname, '../data/stats.json');

function readSessions() {
  try {
    return JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
  } catch {
    return [];
  }
}

function writeSessions(sessions) {
  fs.writeFileSync(sessionsPath, JSON.stringify(sessions, null, 2));
}

function readStats() {
  try {
    return JSON.parse(fs.readFileSync(statsPath, 'utf8'));
  } catch {
    return {};
  }
}

function writeStats(stats) {
  fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2));
}

function addSession(session) {
  const sessions = readSessions();
  sessions.push(session);
  writeSessions(sessions);

  const stats = readStats();
  const game = session.game.toLowerCase();
  if (!stats[game]) {
    stats[game] = { count: 0, lastSession: null, callers: {} };
  }
  stats[game].count++;
  stats[game].lastSession = session.time;
  stats[game].callers[session.callerTag] = (stats[game].callers[session.callerTag] || 0) + 1;
  writeStats(stats);
}

function getSessions() {
  const now = Date.now();
  return readSessions().filter(s => s.time > now && !s.cancelled);
}

function getStats(game) {
  const stats = readStats();
  if (game) return stats[game.toLowerCase()] || null;
  return stats;
}

function cancelSession(id) {
  const sessions = readSessions();
  const index = sessions.findIndex(s => s.id === id);
  if (index === -1) return false;

  const session = sessions[index];
  sessions[index].cancelled = true;
  writeSessions(sessions);

  // Decrement stats for this session
  const stats = readStats();
  const game = session.game.toLowerCase();
  if (stats[game]) {
    stats[game].count = Math.max(0, stats[game].count - 1);

    // Decrement caller count
    if (stats[game].callers[session.callerTag]) {
      stats[game].callers[session.callerTag] = Math.max(0, stats[game].callers[session.callerTag] - 1);

      // Clean up caller entry if it hits 0
      if (stats[game].callers[session.callerTag] === 0) {
        delete stats[game].callers[session.callerTag];
      }
    }

    // If no sessions left, reset lastSession
    if (stats[game].count === 0) {
      stats[game].lastSession = null;
    } else {
      // Set lastSession to the most recent remaining session for this game
      const remaining = sessions.filter(s => s.game.toLowerCase() === game && !s.cancelled);
      stats[game].lastSession = remaining.length > 0
        ? Math.max(...remaining.map(s => s.time))
        : null;
    }

    writeStats(stats);
  }

  return true;
}

function removeExpiredSessions() {
  const sessions = readSessions();
  const now = Date.now();
  const active = sessions.filter(s => s.time > now && !s.cancelled);
  writeSessions(active);
}

module.exports = { addSession, getSessions, getStats, cancelSession, removeExpiredSessions, readSessions };