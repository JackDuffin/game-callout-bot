const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const db = new Database(path.join(dataDir, 'bot.db'));

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    guildId TEXT NOT NULL,
    game TEXT NOT NULL,
    time INTEGER NOT NULL,
    callerTag TEXT NOT NULL,
    channelId TEXT NOT NULL,
    messageId TEXT,
    cancelled INTEGER NOT NULL DEFAULT 0,
    rsvpYes TEXT NOT NULL DEFAULT '[]',
    rsvpNo TEXT NOT NULL DEFAULT '[]',
    extraMessage TEXT NOT NULL DEFAULT '',
    cap INTEGER DEFAULT NULL
  );

  CREATE TABLE IF NOT EXISTS stats (
    guildId TEXT NOT NULL,
    game TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    lastSession INTEGER,
    PRIMARY KEY (guildId, game)
  );

  CREATE TABLE IF NOT EXISTS callers (
    guildId TEXT NOT NULL,
    game TEXT NOT NULL,
    callerTag TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guildId, game, callerTag)
  );

  CREATE TABLE IF NOT EXISTS timezones (
    guildId TEXT NOT NULL,
    userId TEXT,
    timezone TEXT NOT NULL,
    PRIMARY KEY (guildId, userId)
  );

  CREATE TABLE IF NOT EXISTS mutes (
    guildId TEXT NOT NULL,
    userId  TEXT NOT NULL,
    game    TEXT NOT NULL,
    PRIMARY KEY (guildId, userId, game)
  );
`);

// Migration — safe to run on every startup
const existingCols = db.prepare("PRAGMA table_info(sessions)").all().map(c => c.name);
if (!existingCols.includes('cap')) {
  db.exec('ALTER TABLE sessions ADD COLUMN cap INTEGER DEFAULT NULL');
  console.log('✅ Migrated: added cap column to sessions');
}

module.exports = db;