# GameCallout Bot 🎮

**Version:** v0.1.0 | **Last Updated:** 04 April 2026

---

## Background

GameCallout (proper name pending) is a remake of a bot I built a few years ago for my own Discord server and friend group. The original was put together quickly and without much of a plan — it worked but never quite did what I actually wanted it to. The core idea was the same: ping members with a specific game role to hop on and play. But it was limited. There was no scheduling system members could interact with, no way to see upcoming sessions, no stats, and members couldn't manage their own roles — they had to already have the role assigned manually before the bot was any use to them.

Rather than dig back into old code and try to reorient myself around decisions I'd half forgotten, I decided to start fresh with a clearer vision of what I actually wanted to build. This remake is still made with the same thing in mind — a tool for me and my friends — but done properly this time, with a structure I'm actually happy with and features that make it genuinely useful day to day.

The long term plan is to combine this with another old bot I had, some other features we would have liked, bringing everything together into one. For now this is the first piece of that — the game night and community workflow side of things. 

---

## What It Does

A Discord bot built for gaming communities that automates game night organisation. Members self-assign game roles and only receive notifications for the games they actually play. Admins control the official game list, and anyone can schedule a session with automatic reminders and RSVP tracking.

---

## How It Works

The bot is built around game groups — Discord roles that represent games our community plays. Admins define the official list and members opt in to the ones they care about. From there everything flows naturally:

1. **Admin creates a game group** — `/addgame Nightreign` creates an official role
2. **Members join the group** — `/join Nightreign` assigns the role to that member
3. **A member schedules a session** — `/schedule Nightreign 21:30` posts a session embed in the channel, pings the role, and opens RSVP buttons
4. **Members RSVP** — clicking ✅ or ❌ on the embed updates it live with who's going
5. **Bot sends a reminder** — 30 minutes before the session the bot pings the role again
6. **Bot announces the start** — at session time the bot pings the role and lists everyone who RSVPd as going
7. **Stats are tracked** — every session is logged against the game and the person who scheduled it

The key design principle throughout is that members can only interact with games they're actually part of. You can't ping or schedule for a game group you haven't joined — this keeps notifications relevant and prevents spam.

---

## Features

### Role-Based Game Groups
Admins create official game groups (e.g. Nightreign, Valorant, Minecraft). Members join the groups they play and leave the ones they don't. This forms the foundation of the notification system — members only get pinged for games they care about.

### Role-Based Access Control
A core design decision throughout the bot is that members can only interact with game groups they belong to. Callouts, session scheduling and cancellations are all gated behind membership of the relevant game group. This keeps notifications meaningful — if you're getting pinged for Nightreign it's because someone in that group called it, not a random member. Admins are the only ones who can create or remove game groups, keeping the list clean and intentional.

### Callouts
Any member who belongs to a game group can trigger a callout for it. The bot pings everyone in that group with a message. Members who aren't in the group can't trigger callouts for it — this prevents spam and keeps notifications relevant.

### Session Scheduling
Members can schedule game sessions in advance with a time and optional message. The bot posts a session embed in the channel showing the time, who scheduled it, and RSVP buttons. It automatically sends a reminder 30 minutes before the session starts and a final ping when the session begins, listing everyone who RSVPd as going.

### RSVP Tracking
When a session is scheduled, members can click ✅ I'm in or ❌ Can't make it directly on the embed. The embed updates live to show who's going and who isn't. Members can change their RSVP at any time before the session starts.

### Session Management
Members can view all upcoming sessions with `/sessions` and cancel sessions they scheduled with `/cancelsession`. If a member has multiple upcoming sessions for the same game, the bot shows a dropdown to pick which one to cancel.

### Stats Tracking
The bot tracks how many sessions have been scheduled per game, who schedules them most, and when the last session was. Stats update automatically when sessions are scheduled and decrease when sessions are cancelled.

### Persistent Storage
All sessions and stats are stored in JSON files on the server. The bot remembers everything across restarts — scheduled sessions are restored and their timers re-registered automatically when the bot comes back online.

JSON was chosen over a database deliberately for this version — it requires no setup, is easy to inspect and debug, and is more than sufficient for a single server bot at this scale. The tradeoff is that it's less robust under concurrent writes and harder to scale. Migrating to a proper database is on the roadmap.

---

## Commands

### Admin Commands
| Command | Description |
|---|---|
| `/addgame <name>` | Creates an official game group role |
| `/removegame <name>` | Removes a game group role |

### Member Commands
| Command | Description |
|---|---|
| `/join <game>` | Join a game group to receive callouts |
| `/leave <game>` | Leave a game group |
| `/games` | List all available game groups and member counts |
| `/callout <game> [message]` | Ping all members of a game group |
| `/schedule <game> <time> [message]` | Schedule a session with RSVP buttons |
| `/cancelsession <game>` | Cancel a session you scheduled |
| `/sessions` | View all upcoming scheduled sessions |
| `/stats [game]` | View session stats for a specific game or all games |

### Scheduling Time Formats
| Format | Example | Description |
|---|---|---|
| `HH:MM` | `21:30` | Today, or tomorrow if the time has already passed |
| `HH:MM DD/MM` | `21:30 25/04` | Specific date, current year assumed |
| `HH:MM DD/MM/YY` | `21:30 25/04/27` | Specific date, 2-digit year (27 = 2027) |
| `HH:MM DD/MM/YYYY` | `21:30 25/04/2027` | Specific date, full year |

---

## Known Limitations

These are conscious tradeoffs made for this version of the bot rather than oversights — most are on the roadmap to be addressed as the project grows.

- **No timezone support** — session times are based on the local time of the machine running the bot. For now all members are assumed to be in the same timezone, which works fine for a friend group but would need addressing for a wider audience
- **Sessions can't be edited** — once a session is scheduled the time and message can't be changed. The only option is to cancel and reschedule. Session editing is planned for a future update
- **Data is tied to the VM** — sessions and stats are stored as JSON files on the host machine. If the VM is wiped or recreated the data is lost. Migrating to a proper database would solve this and is already on the roadmap
- **Single server focused** — the bot currently registers commands to one server. Global deployment with proper per-server data isolation is not yet implemented
- **No session history** — only upcoming sessions are visible. Past sessions are not stored or viewable once they have passed

---

## Ideas for the Future

These are things I'd like to explore adding at some point — nothing confirmed but most are on the radar.

**Database migration**
The current JSON file storage works well enough but has limitations around concurrent writes and data integrity. Moving to a proper database like SQLite or PostgreSQL would make the bot more robust and lay better groundwork for everything else on this list.

**Global deployment**
Currently the bot is registered to a single server. Registering commands globally and adding proper per-server isolation for game groups, sessions and stats would allow it to be used across multiple servers independently.

**Admin dashboard**
A single `/admin` command that gives server admins a full overview of all game groups, active sessions, recent stats and bot health in one place rather than having to run multiple commands.

**Session history**
A way to view past sessions rather than just upcoming ones — useful for tracking activity over time and seeing which games a community has been most active in.

**Expanded stats**
More granular stats like peak activity times, most active members, games that are growing or declining in activity, and session completion rates based on RSVP vs actual attendance.

**Timezone support**
Allow members or admins to set a server timezone so session times are consistent regardless of where the bot is hosted or where members are based.

**Session editing**
Allow the person who scheduled a session to edit the time or message without having to cancel and reschedule entirely.

**Second bot integration**
The long term goal is to combine this with a second bot I previously built, merging both into a single unified bot. More details on that when the time comes.

---

## Development Notes

### How It Evolved From the Original

The original bot had one job — ping a role on a schedule. There was no command to view upcoming sessions, no stats, no RSVP system, and members couldn't manage their own roles. If you didn't already have the game role assigned manually the bot was useless to you.

This remake addresses all of those gaps. The role management system means any member can self-serve without needing an admin to manually assign roles. The scheduling system is now interactive with live RSVP tracking rather than a fire-and-forget ping. Stats give the community visibility into activity over time. And the admin controls keep the game list clean rather than letting it fragment through typos and duplicates.

### Issues Encountered and How They Were Resolved

**Free role creation allowed duplicates**
Initially any member could create a game role by typing any name into `/join`. This led to fragmented groups from typos and inconsistent capitalisation (e.g. "Nightreign", "nightreign", "Niightreign" all existing separately). This was resolved by adding admin-only `/addgame` and `/removegame` commands. Members now select from an existing list rather than typing freely, making duplicates impossible.

**RSVP tracking not updating correctly**
The session start notification always showed "Nobody RSVPd" even when members had clicked the RSVP buttons. The issue was that the timeout closure was capturing a reference to the original empty RSVP arrays at the time the session was created rather than reading the live data when the timeout fired. The fix was to read directly from `client.rsvpSessions[sessionId]` inside the timeout callback so it always reflects the current state at fire time.

**Slash commands timing out**
Several commands were returning "The application did not respond" in Discord. This was caused by the bot process not running — closing the terminal window stops the bot. This was resolved by deploying to a cloud VM and using PM2 to keep the bot running permanently as a background process that survives terminal disconnects and reboots.

**Sessions not surviving restarts**
When the bot restarted all scheduled sessions and their timers were lost since they were stored in memory only. This was resolved by writing sessions and stats to JSON files on disk and rebuilding all timers on startup from the stored data.

**setTimeout overflow for far-future sessions**
JavaScript's setTimeout uses a 32-bit signed integer for the delay value, which overflows at approximately 24.8 days. Scheduling a session more than 24 days in the future caused the timeout to fire immediately. This was resolved with a recursive `safeTimeout` function that chains multiple shorter timeouts together to reach any future date reliably.

**Deprecation warnings in discord.js v14**
Two deprecation warnings appeared after upgrading Node.js — `ephemeral: true` being replaced by `flags: 64`, and the `ready` event being renamed to `clientReady`. Both were updated across all command files and the main index.

**Stats not updating on cancellation**
Cancelling a session did not decrease the session count or top caller stats. The fix was to update `sessionStore.js` to decrement the count and caller tally when `cancelSession` is called, and recalculate `lastSession` from the remaining active sessions for that game.

**Scheduling time parsing too strict**
The original time parser only accepted full 4-digit years (e.g. `25/04/2027`). This was improved to also accept 2-digit years (e.g. `25/04/27`) by detecting values under 100 and prefixing them with 2000.

---

## Tech Stack

The bot is built entirely in JavaScript on Node.js and hosted on Oracle Cloud's Always Free tier, keeping running costs at zero.

- [discord.js](https://discord.js.org) v14
- [Node.js](https://nodejs.org) v20
- [uuid](https://www.npmjs.com/package/uuid)
- [dotenv](https://www.npmjs.com/package/dotenv)
- Hosted on Oracle Cloud Always Free tier
- Kept alive with PM2

---

*A personal project — built for me and my friends, with room to grow.*
