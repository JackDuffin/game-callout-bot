# GameCallout Bot 🎮

**Version:** v0.4.0 | **Last Updated:** 18 June 2026

---

## Background

GameCallout (proper name pending) is a remake of a bot I built a few years ago for my own Discord server and friend group. The original was put together quickly and without much of a plan — it worked, but it was bare bones by design. Only an admin with the right role could use it, and it never grew beyond that.

The core idea was simple: ping members with a game role when someone wanted to play. But the execution had real gaps. Scheduling was admin-only — only someone with server permissions could set up a session, and even then there was no embed, no RSVP system, and no way for anyone to see what was coming up. Game roles had to be assigned manually by an admin too, so if you weren't already set up before the bot was running, it was useless to you. There were no stats, no history, and no way for members to manage anything themselves.

Rather than dig back into old code and try to reorient myself around decisions I'd half forgotten, I decided to start fresh with a clearer vision of what I actually wanted to build. This remake keeps the same core idea — a tool for organising game nights with friends — but does it properly this time, with a structure I'm happy with and features that make it genuinely useful day to day.

The long term plan is to eventually merge this with a second old bot and bring everything together into one. For now this is the foundation — the game night and community workflow side of things.

---

## Why Not Just Use Discord's Scheduled Events?

Discord has a built-in Scheduled Events feature. It's worth explaining why this bot exists alongside it.

Discord's Scheduled Events let you create an event with a name, time, and description. Members can mark themselves as "Interested" and get a notification when it starts. For a simple one-off event it works fine. But it has real limitations for a group that plays together regularly across multiple games:

**Role-based filtering.** Discord Events notify everyone, or nobody. The bot's whole premise is that you only get pinged for games you've actually joined. In a server with multiple games, that's the difference between relevant pings and noise.

**Firm RSVP.** "Interested" is vague. The bot has a firm yes/no split, which is what you actually need to know whether you have enough players for a session.

**Player cap.** Discord Events have no concept of a fixed-size game. For something like Nightreign — which is exactly 3 players — the bot locks the ✅ button once the cap is reached and tells latecomers the session is full.

**Instant callouts.** `/callout` requires no scheduling at all. It's just "who's on right now, hop on." Discord Events have no equivalent.

**Stats and history.** Discord Events track nothing. The bot logs every session — who organised it, who attended, how often you play, what day and time you usually play, longest active streak.

**Reminder control.** Members can mute the 30-minute and start pings per game if they find them noisy, while still receiving the initial session announcement.

The honest answer is that if your server has one game and a small group, Discord Events would probably do the job. This bot earns its place when you're juggling multiple games and want pings to stay meaningful.

---

## What It Does

A Discord bot built for gaming communities that automates game night organisation. Members self-assign game roles and only receive notifications for the games they actually play. Admins control the official game list, and anyone can schedule a session with automatic reminders, RSVP tracking, and optional player caps.

---

## How It Works

The bot is built around game groups — Discord roles that represent games our community plays. Admins define the official list and members opt in to the ones they care about. From there everything flows naturally:

1. **Admin creates a game group** — `/addgame Nightreign` creates an official role
2. **Members join the group** — `/join Nightreign` assigns the role to that member
3. **A member schedules a session** — `/schedule Nightreign 21:30` posts a session embed in the channel, pings the role, and opens RSVP buttons. An optional cap can be set for fixed-player games. Sessions can be set to repeat weekly with `repeat: True`
4. **Members RSVP** — clicking ✅ or ❌ on the embed updates it live with who's going. If a cap is set, the ✅ button locks once it's reached
5. **Bot sends a reminder** — 30 minutes before the session, the bot mentions each member individually rather than pinging the role. Members who have muted reminders for that game are excluded
6. **Bot announces the start** — at session time the bot mentions active members again and lists everyone who RSVPd as going. If the session is recurring, the next occurrence is automatically queued for one week later
7. **Stats are tracked** — every session is logged against the game and the person who scheduled it
8. **Sessions can be edited** — the scheduler can update the time, cap or message at any time before it starts, and the embed updates in place
9. **History is retained** — past sessions are kept in the database and can be browsed with `/history`, with pagination for larger histories

The key design principle throughout is that members can only interact with games they're actually part of. You can't ping or schedule for a game group you haven't joined — this keeps notifications relevant and prevents spam.

---

## Features

### Role-Based Game Groups
Admins create official game groups (e.g. Nightreign, Valorant, Minecraft). Members join the groups they play and leave the ones they don't. This forms the foundation of the notification system — members only get pinged for games they care about.

### Role-Based Access Control
A core design decision throughout the bot is that members can only interact with game groups they belong to. Callouts, session scheduling, cancellations and edits are all gated behind membership of the relevant game group. This keeps notifications meaningful — if you're getting pinged for Nightreign it's because someone in that group called it, not a random member. Admins are the only ones who can create or remove game groups, keeping the list clean and intentional.

### Autocomplete
Every command that takes a game name uses Discord's native autocomplete. The suggestions are context-aware — `/join` shows games you're not already in, `/leave` and `/callout` show only games you're a member of, `/cancelsession` shows only games you have upcoming sessions for.

### Callouts
Any member who belongs to a game group can trigger an instant callout for it. The bot posts an embed pinging everyone in that group — no scheduling required. A per-game cooldown of one hour prevents the same group being called out repeatedly in a short window. Members who aren't in the group can't trigger callouts for it.

### Session Scheduling
Members can schedule game sessions in advance with a time and optional message. An optional player cap can be set for fixed-size games. The bot posts a session embed showing the time, who scheduled it, current RSVP counts, and RSVP buttons. It automatically sends a 30-minute reminder and a start ping when the session begins.

### Recurring Sessions
Any session can be set to repeat weekly by toggling `repeat: True` when scheduling. When the session starts, the bot automatically posts the next occurrence one week later with a fresh embed and RSVP buttons. The recurring embed shows a 🔁 Repeats weekly footer so members know to expect it. Each occurrence is independent — it can be cancelled individually without affecting the rest of the chain.

### Player Cap
When scheduling a session, an optional cap sets the maximum number of players. The embed shows spots filled out of the cap (e.g. `2/3`). Once full, the ✅ button locks and displays as disabled. If a player switches their RSVP to ❌, a spot opens back up and the button re-enables automatically.

### Session Editing
The person who scheduled a session can edit the time, player cap or message at any time before the session starts. The original embed updates in place with the new details, and any timers are rescheduled automatically. If a member has multiple upcoming sessions for the same game, a dropdown is shown to pick which one to edit. Setting the cap to 0 removes it entirely.

### RSVP Tracking
When a session is scheduled, members can click ✅ I'm in or ❌ Can't make it directly on the embed. The embed updates live to show who's going and who isn't. Members can change their RSVP at any time before the session starts. RSVP data is persisted to the database so it survives bot restarts.

### Reminder Muting
Members can mute the 30-minute and session-start pings for any game they're in using `/mutereminders`. The initial session announcement still pings the role as normal — only the follow-up reminders are suppressed. Reminders can be turned back on at any time with `/unmutereminders`.

### Session Management
Members can view all upcoming sessions with `/sessions` (optionally filtered by game, with pagination), cancel sessions they scheduled with `/cancelsession`, and edit sessions with `/editschedule`. If a member has multiple upcoming sessions for the same game, the bot shows a dropdown to pick which one to act on.

### Session History
Past sessions are retained in the database rather than deleted. Members can browse history with `/history`, optionally filtered by game. Results are paginated with Previous/Next buttons for servers with longer histories.

### Admin Dashboard
`/admin` gives server admins a single ephemeral overview showing the server timezone, all game groups with member counts and an indicator for upcoming sessions, and all currently scheduled sessions across all games.

### Timezone Support
Admins can set a server-wide timezone with `/settimezone`. Members can optionally override this with their own personal timezone using `/mytimezone`. Times are parsed in the user's configured timezone and displayed via Discord's native timestamp format, which handles local conversion automatically for each member.

### Stats Tracking
The bot tracks detailed stats per game. `/stats` shows a compact summary across all games. `/stats <game>` shows a full breakdown including sessions played, most active organiser, last played, group size, usual day and time, average turnout, most reliable member, and longest active streak. Detailed insights require at least 3 past sessions.

### Persistent Storage
All sessions, stats and settings are stored in a SQLite database on the server. The bot remembers everything across restarts — scheduled sessions are restored and their timers re-registered automatically when the bot comes back online. Session restoration works correctly across multiple servers. Data is isolated per server.

---

## Commands

### Admin Commands
| Command | Description |
|---|---|
| `/addgame <name>` | Creates an official game group role |
| `/removegame <name>` | Removes a game group role |
| `/settimezone <timezone>` | Sets the server timezone for session scheduling |
| `/admin` | View the server dashboard — game groups, upcoming sessions, and timezone |

### Member Commands
| Command | Description |
|---|---|
| `/join <game>` | Join a game group to receive callouts |
| `/leave <game>` | Leave a game group |
| `/games` | List all available game groups and member counts |
| `/callout <game> [message]` | Ping all members of a game group instantly (1 hour cooldown per game) |
| `/schedule <game> <time> [cap] [repeat] [message]` | Schedule a session with RSVP buttons, optional player cap, and optional weekly repeat |
| `/editschedule <game> [time] [cap] [message]` | Edit a session you scheduled |
| `/cancelsession <game>` | Cancel a session you scheduled |
| `/sessions [game] [page]` | View upcoming scheduled sessions, optionally filtered by game |
| `/history [game] [page]` | Browse past sessions with pagination, optionally filtered by game |
| `/stats [game]` | View session stats for a specific game or all games |
| `/mutereminders <game>` | Mute 30-minute and start reminders for a game |
| `/unmutereminders <game>` | Unmute reminders for a game |
| `/mytimezone [timezone]` | Set your personal timezone, or view your current one |

### Scheduling Time Formats
| Format | Example | Description |
|---|---|---|
| `HH:MM` | `21:30` | Today, or tomorrow if the time has already passed |
| `HH:MM DD/MM` | `21:30 25/04` | Specific date, current year assumed |
| `HH:MM DD/MM/YY` | `21:30 25/04/27` | Specific date, 2-digit year (27 = 2027) |
| `HH:MM DD/MM/YYYY` | `21:30 25/04/2027` | Specific date, full year |

Times are interpreted in the user's personal timezone if set, otherwise the server timezone, otherwise UTC.

---

## Known Limitations

These are conscious tradeoffs made for this version of the bot rather than oversights — most are on the roadmap to be addressed as the project grows.

- **Recurring sessions cancel individually** — cancelling one occurrence of a recurring session does not stop future occurrences. Cancel the next queued session manually to stop the chain
- **Streak calculation is calendar-week based** — the longest active streak counts consecutive calendar weeks with at least one session, not rolling seven-day windows

---

## Ideas for the Future

These are things I'd like to explore adding at some point — nothing confirmed but some are on the radar.

**Maybe RSVP**
A third RSVP option — "maybe" — for members who aren't sure yet. Lower priority since the firm yes/no split is intentional, but worth revisiting.

**Interaction handler consolidation**
The pagination button handlers for `/sessions` and `/history` currently live inline in `index.js`. Moving these into their respective command files would keep `index.js` lean and make the codebase easier to navigate as it grows.

**Second bot integration**
The long term goal is to combine this with a second bot I previously built, merging both into a single unified bot. More details on that when the time comes.

---

## Development Notes

### How It Evolved From the Original

The original bot had one job — ping a role when an admin triggered it. There was no command to view upcoming sessions, no stats, no RSVP system, and members couldn't manage anything themselves. Roles had to be assigned manually by an admin, so the bot was effectively useless to anyone who hadn't been set up in advance.

This remake addresses all of those gaps. The role management system means any member can self-serve without needing an admin to manually assign roles. The scheduling system is now open to all members and interactive — with live RSVP tracking, reminders, and a start ping — rather than an admin-only fire-and-forget command. Stats and history give the community visibility into activity over time. And the admin controls keep the game list clean rather than letting it fragment through typos and duplicates.

### Issues Encountered and How They Were Resolved

**Free role creation allowed duplicates**
Initially any member could create a game role by typing any name into `/join`. This led to fragmented groups from typos and inconsistent capitalisation. This was resolved by adding admin-only `/addgame` and `/removegame` commands. Members now select from an existing list rather than typing freely, making duplicates impossible.

**RSVP tracking not updating correctly**
The session start notification always showed "Nobody RSVPd" even when members had clicked the RSVP buttons. The issue was that the timeout closure was capturing a reference to the original empty RSVP arrays rather than reading the live data when the timeout fired. The fix was to read directly from `client.rsvpSessions[sessionId]` inside the timeout callback.

**Slash commands timing out**
Several commands were returning "The application did not respond" in Discord. This was caused by Discord's 3-second interaction response window being exceeded for commands that do async work before replying. Resolved by calling `deferReply` at the start of every command that does meaningful async work.

**Sessions not surviving restarts**
When the bot restarted all scheduled sessions and their timers were lost since they were stored in memory only. Resolved by persisting sessions to a SQLite database and rebuilding all timers on startup from the stored data.

**setTimeout overflow for far-future sessions**
JavaScript's setTimeout uses a 32-bit signed integer for the delay value, which overflows at approximately 24.8 days. Scheduling a session more than 24 days in the future caused the timeout to fire immediately. Resolved with a recursive `safeTimeout` function that chains multiple shorter timeouts together.

**Deprecation warnings in discord.js v14**
Two deprecation warnings appeared after upgrading Node.js — `ephemeral: true` being replaced by `flags: 64`, and the `ready` event being renamed to `clientReady`. Both were updated across all files.

**Stats not updating on cancellation**
Cancelling a session did not decrease the session count or top caller stats. Resolved by decrementing the count and caller tally in `cancelSession` and recalculating `lastSession` from remaining active sessions.

**Scheduling time parsing too strict**
The original time parser only accepted full 4-digit years. Improved to also accept 2-digit years by detecting values under 100 and prefixing them with 2000.

**RSVP data lost on restart**
RSVP button clicks were only stored in memory. Resolved by writing RSVP updates back to the database every time a member clicks a button.

**Timezone mismatch between VM and members**
Session times were previously interpreted in whatever timezone the host VM was running in. Resolved by adding per-server and per-user timezone support, with times stored as UTC and displayed via Discord's native timestamp format.

**Dual-instance interaction clash**
When both the VM bot and a local development instance ran simultaneously, Discord sent interactions to both. Whichever consumed the token first won — the other's `deferReply` failed with `Unknown interaction`. Resolved by always stopping the VM instance via PM2 before running locally, and using a separate test server for local development.

**Session restoration only worked for one server**
On startup the bot was restoring timers only for the first guild in its cache, meaning sessions in any other server were silently lost after a restart. Fixed by reading all sessions from the database and looking up each session's guild by its stored `guildId`, so restoration works correctly regardless of how many servers the bot is in.

---

## Tech Stack

The bot is built entirely in JavaScript on Node.js and hosted on Oracle Cloud's Always Free tier, keeping running costs at zero.

- [discord.js](https://discord.js.org) v14
- [Node.js](https://nodejs.org) v20
- [better-sqlite3](https://www.npmjs.com/package/better-sqlite3)
- [uuid](https://www.npmjs.com/package/uuid)
- [dotenv](https://www.npmjs.com/package/dotenv)
- Hosted on Oracle Cloud Always Free tier
- Kept alive with PM2

---

*A personal project — built for me and my friends, with room to grow.*