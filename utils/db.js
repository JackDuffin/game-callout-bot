const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const db = new Database(path.join(dataDir, 'bot.db'));

// WAL (Write-Ahead Logging) lets reads proceed concurrently with a write,
// which matters when the bot is processing interactions while a timer fires.
db.pragma('journal_mode = WAL');

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
    cap INTEGER DEFAULT NULL,
    recurring INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS stats (
    guildId TEXT NOT NULL,
    game TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    lastSession INTEGER,
    PRIMARY KEY (guildId, game)
  );

  -- One row per (guild, game, caller) so we can find the top organiser cheaply.
  CREATE TABLE IF NOT EXISTS callers (
    guildId TEXT NOT NULL,
    game TEXT NOT NULL,
    callerTag TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guildId, game, callerTag)
  );

  -- userId IS NULL means server-level; a non-null userId is a personal override.
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

  CREATE TABLE IF NOT EXISTS callout_cooldowns (
    guildId TEXT NOT NULL,
    game    TEXT NOT NULL,
    lastAt  INTEGER NOT NULL,
    PRIMARY KEY (guildId, game)
  );
`);

// Migrations — each block is idempotent; safe to run on every startup.
// PRAGMA table_info is the simplest way to check for a column without
// attempting the ALTER and catching the error.
const existingCols = db.prepare('PRAGMA table_info(sessions)').all().map(c => c.name);

if (!existingCols.includes('cap')) {
  db.exec('ALTER TABLE sessions ADD COLUMN cap INTEGER DEFAULT NULL');
  console.log('✅ Migrated: added cap column to sessions');
}

if (!existingCols.includes('recurring')) {
  db.exec('ALTER TABLE sessions ADD COLUMN recurring INTEGER NOT NULL DEFAULT 0');
  console.log('✅ Migrated: added recurring column to sessions');
}

module.exports = db;