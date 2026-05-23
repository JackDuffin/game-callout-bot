const db = require('./db');

function addSession(session) {
  db.prepare(`
    INSERT OR REPLACE INTO sessions (id, guildId, game, time, callerTag, channelId, messageId, cancelled, rsvpYes, rsvpNo, extraMessage)
    VALUES (@id, @guildId, @game, @time, @callerTag, @channelId, @messageId, @cancelled, @rsvpYes, @rsvpNo, @extraMessage)
  `).run({
    ...session,
    cancelled: session.cancelled ? 1 : 0,
    rsvpYes: JSON.stringify(session.rsvpYes || []),
    rsvpNo: JSON.stringify(session.rsvpNo || []),
    extraMessage: session.extraMessage || ''
  });

  // Update stats
  db.prepare(`
    INSERT INTO stats (guildId, game, count, lastSession)
    VALUES (@guildId, @game, 1, @time)
    ON CONFLICT(guildId, game) DO UPDATE SET
      count = count + 1,
      lastSession = MAX(lastSession, @time)
  `).run({ guildId: session.guildId, game: session.game.toLowerCase(), time: session.time });

  // Update callers
  db.prepare(`
    INSERT INTO callers (guildId, game, callerTag, count)
    VALUES (@guildId, @game, @callerTag, 1)
    ON CONFLICT(guildId, game, callerTag) DO UPDATE SET
      count = count + 1
  `).run({ guildId: session.guildId, game: session.game.toLowerCase(), callerTag: session.callerTag });
}

function updateSession(id, changes) {
  const existing = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  if (!existing) return false;

  const updated = {
    ...existing,
    ...changes,
    rsvpYes: JSON.stringify(changes.rsvpYes !== undefined ? changes.rsvpYes : JSON.parse(existing.rsvpYes)),
    rsvpNo: JSON.stringify(changes.rsvpNo !== undefined ? changes.rsvpNo : JSON.parse(existing.rsvpNo)),
  };

  db.prepare(`
    UPDATE sessions SET
      time = @time,
      extraMessage = @extraMessage,
      rsvpYes = @rsvpYes,
      rsvpNo = @rsvpNo
    WHERE id = @id
  `).run(updated);

  if (changes.time) {
    const game = existing.game.toLowerCase();
    const guildId = existing.guildId;
    const lastSession = db.prepare(`
      SELECT MAX(time) as maxTime FROM sessions
      WHERE guildId = ? AND game = ? AND cancelled = 0
    `).get(guildId, game);

    db.prepare(`
      UPDATE stats SET lastSession = ? WHERE guildId = ? AND game = ?
    `).run(lastSession?.maxTime || null, guildId, game);
  }

  return true;
}

function getSessions(guildId) {
  const now = Date.now();
  const rows = db.prepare(`
    SELECT * FROM sessions
    WHERE guildId = ? AND time > ? AND cancelled = 0
    ORDER BY time ASC
  `).all(guildId, now);

  return rows.map(deserialiseSession);
}

function readSessions(guildId) {
  const rows = guildId
    ? db.prepare('SELECT * FROM sessions WHERE guildId = ? ORDER BY time ASC').all(guildId)
    : db.prepare('SELECT * FROM sessions ORDER BY time ASC').all();

  return rows.map(deserialiseSession);
}

function getHistory(guildId, game = null, limit = 10) {
  const now = Date.now();
  let rows;

  if (game) {
    rows = db.prepare(`
      SELECT * FROM sessions
      WHERE guildId = ? AND game = ? AND time < ? AND cancelled = 0
      ORDER BY time DESC
      LIMIT ?
    `).all(guildId, game.toLowerCase(), now, limit);
  } else {
    rows = db.prepare(`
      SELECT * FROM sessions
      WHERE guildId = ? AND time < ? AND cancelled = 0
      ORDER BY time DESC
      LIMIT ?
    `).all(guildId, now, limit);
  }

  return rows.map(deserialiseSession);
}

function getStats(guildId, game) {
  if (game) {
    const statsRow = db.prepare('SELECT * FROM stats WHERE guildId = ? AND game = ?').get(guildId, game.toLowerCase());
    if (!statsRow) return null;

    const callerRows = db.prepare('SELECT * FROM callers WHERE guildId = ? AND game = ? ORDER BY count DESC').all(guildId, game.toLowerCase());
    const callers = {};
    for (const row of callerRows) callers[row.callerTag] = row.count;

    return { count: statsRow.count, lastSession: statsRow.lastSession, callers };
  }

  const statsRows = db.prepare('SELECT * FROM stats WHERE guildId = ?').all(guildId);
  const result = {};

  for (const statsRow of statsRows) {
    const callerRows = db.prepare('SELECT * FROM callers WHERE guildId = ? AND game = ? ORDER BY count DESC').all(guildId, statsRow.game);
    const callers = {};
    for (const row of callerRows) callers[row.callerTag] = row.count;
    result[statsRow.game] = { count: statsRow.count, lastSession: statsRow.lastSession, callers };
  }

  return result;
}

function getDetailedStats(guildId, game, guild) {
  const now = Date.now();
  const gameLower = game.toLowerCase();

  const sessions = db.prepare(`
    SELECT * FROM sessions
    WHERE guildId = ? AND game = ? AND time < ? AND cancelled = 0
    ORDER BY time ASC
  `).all(guildId, gameLower, now).map(deserialiseSession);

  if (sessions.length === 0) return null;

  // Usual time of day (most common hour)
  const hourCounts = {};
  for (const s of sessions) {
    const hour = new Date(s.time).getHours();
    hourCounts[hour] = (hourCounts[hour] || 0) + 1;
  }
  const peakHour = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0];
  const peakHourStr = peakHour ? `${String(peakHour[0]).padStart(2, '0')}:00` : null;

  // Usual day of week (most common day)
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayCounts = {};
  for (const s of sessions) {
    const day = days[new Date(s.time).getDay()];
    dayCounts[day] = (dayCounts[day] || 0) + 1;
  }
  const peakDay = Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0];

  // Average turnout (avg rsvpYes per session)
  const totalAttendance = sessions.reduce((sum, s) => sum + s.rsvpYes.length, 0);
  const avgAttendance = (totalAttendance / sessions.length).toFixed(1);

  // Most reliable member (most rsvpYes across all sessions)
  const rsvpCounts = {};
  for (const s of sessions) {
    for (const user of s.rsvpYes) {
      rsvpCounts[user] = (rsvpCounts[user] || 0) + 1;
    }
  }
  const topRsvp = Object.entries(rsvpCounts).sort((a, b) => b[1] - a[1])[0];

  // Longest active streak (consecutive weeks with at least one session)
  const weekNumbers = sessions.map(s => {
    const d = new Date(s.time);
    const startOfYear = new Date(d.getFullYear(), 0, 1);
    return Math.floor((d - startOfYear) / (7 * 24 * 60 * 60 * 1000));
  });
  const uniqueWeeks = [...new Set(weekNumbers)].sort((a, b) => a - b);

  let longestStreak = 1;
  let currentStreak = 1;
  for (let i = 1; i < uniqueWeeks.length; i++) {
    if (uniqueWeeks[i] === uniqueWeeks[i - 1] + 1) {
      currentStreak++;
      longestStreak = Math.max(longestStreak, currentStreak);
    } else {
      currentStreak = 1;
    }
  }

  // Group size — number of members with the role
  let groupSize = null;
  if (guild) {
    const role = guild.roles.cache.find(r => r.name.toLowerCase() === gameLower);
    if (role) groupSize = role.members.size;
  }

  return {
    peakHour: peakHourStr,
    peakDay: peakDay ? peakDay[0] : null,
    avgAttendance,
    topRsvp: topRsvp ? topRsvp[0] : null,
    topRsvpCount: topRsvp ? topRsvp[1] : 0,
    longestStreak,
    groupSize,
    hasEnoughData: sessions.length >= 3
  };
}

function cancelSession(id) {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  if (!session) return false;

  db.prepare('UPDATE sessions SET cancelled = 1 WHERE id = ?').run(id);

  const game = session.game.toLowerCase();
  const guildId = session.guildId;

  db.prepare('UPDATE stats SET count = MAX(0, count - 1) WHERE guildId = ? AND game = ?').run(guildId, game);
  db.prepare('UPDATE callers SET count = MAX(0, count - 1) WHERE guildId = ? AND game = ? AND callerTag = ?').run(guildId, game, session.callerTag);
  db.prepare('DELETE FROM callers WHERE guildId = ? AND game = ? AND callerTag = ? AND count = 0').run(guildId, game, session.callerTag);

  const lastSession = db.prepare(`
    SELECT MAX(time) as maxTime FROM sessions
    WHERE guildId = ? AND game = ? AND cancelled = 0
  `).get(guildId, game);

  db.prepare('UPDATE stats SET lastSession = ? WHERE guildId = ? AND game = ?').run(lastSession?.maxTime || null, guildId, game);

  return true;
}

function setTimezone(guildId, timezone, userId = null) {
  db.prepare(`
    INSERT INTO timezones (guildId, userId, timezone)
    VALUES (@guildId, @userId, @timezone)
    ON CONFLICT(guildId, userId) DO UPDATE SET timezone = @timezone
  `).run({ guildId, userId, timezone });
}

function getTimezone(guildId, userId = null) {
  if (userId) {
    const userRow = db.prepare('SELECT timezone FROM timezones WHERE guildId = ? AND userId = ?').get(guildId, userId);
    if (userRow) return userRow.timezone;
  }

  const serverRow = db.prepare('SELECT timezone FROM timezones WHERE guildId = ? AND userId IS NULL').get(guildId);
  if (serverRow) return serverRow.timezone;

  return 'UTC';
}

function removeExpiredSessions() {
  // No-op — past sessions are kept as history
}

function deserialiseSession(row) {
  return {
    ...row,
    cancelled: row.cancelled === 1,
    rsvpYes: JSON.parse(row.rsvpYes || '[]'),
    rsvpNo: JSON.parse(row.rsvpNo || '[]'),
  };
}

module.exports = {
  addSession, updateSession, getSessions, readSessions, getHistory,
  getStats, getDetailedStats, cancelSession, removeExpiredSessions,
  setTimezone, getTimezone
};