# ⚔ The Chronicler
### A self-hosted D&D party notes application

> A dark-fantasy themed notes, journal, and knowledge graph app built for tabletop RPG groups. Self-hosted via Docker. Built with Node.js, SQLite, and React.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Requirements](#requirements)
3. [Installation](#installation)
4. [Configuration](#configuration)
5. [First Boot](#first-boot)
6. [Vocabulary](#vocabulary)
7. [Roles & Permissions](#roles--permissions)
8. [Features](#features)
9. [Mobile & PWA](#mobile--pwa)
10. [AI Features](#ai-features)
11. [Backups & Snapshots](#backups--snapshots)
12. [Maintenance](#maintenance)
13. [Updating](#updating)
14. [Troubleshooting](#troubleshooting)
15. [Stack](#stack)

---

## Quick Start

```bash
git clone https://github.com/yourname/dnd-chronicler.git
cd dnd-chronicler
docker compose up -d --build
```

A `JWT_SECRET` is auto-generated on first boot and persisted in the data volume.

App available at `http://localhost:3001`

Default login: `admin` / `admin` — **change this immediately.**

---

## Requirements

| Component | Minimum | Recommended |
|---|---|---|
| Docker | 20.10+ | Latest |
| Docker Compose | v2+ | Latest |
| RAM | 2GB | 4GB (builds are memory-intensive) |
| Disk | 1GB free | 5GB+ |
| OS | Linux / macOS / Windows WSL2 | Linux |

---

## Installation

### 1. Clone the repository
```bash
git clone https://github.com/yourname/dnd-chronicler.git
cd dnd-chronicler
```

### 2. Start the app

A `JWT_SECRET` is auto-generated on first boot and saved to the data volume (`/data/.jwt_secret`).
To override it, set `JWT_SECRET` in the `environment` section of `docker-compose.yml` or in a `.env` file.

### 3. Build and run
```bash
docker compose up -d --build
```

### 4. Open the app
Navigate to `http://your-server-ip:3001`

---

### Exposing publicly via Cloudflare Tunnel (recommended)
```bash
cloudflared tunnel --url http://localhost:3001
```
This gives you a public HTTPS URL without opening firewall ports.

---

## Configuration

| Variable | Default | Description |
|---|---|---|
| `JWT_SECRET` | auto-generated | Signing key for auth tokens. Auto-generated and persisted in `/data/.jwt_secret`. Override via environment or `.env` file. |
| `PORT` | `3001` | Port the app listens on |
| `DB_DIR` | `/data` | Path inside container for SQLite database |
See `.env.example` for the minimal environment template. Session recaps use **Anthropic**; configure the API key in **Admin → AI** (stored in the database).

---

## First Boot

1. Log in with `admin` / `admin`
2. You will see a warning banner — **change your password immediately** via Admin Panel → PASSWORD
3. Open Admin Panel (⚔ icon, top right)
4. Set registration open/closed under the PARTY tab
5. Create your first Campaign from the sidebar (+ Folder)
6. Assign a DM during campaign creation
7. Add party members to the campaign

---

## Vocabulary

### App Concepts

| Term | Description |
|---|---|
| **Admin** | App-wide superuser. Trumps all roles in all campaigns. Can manage users, settings, AI, backups, and all content regardless of campaign ownership. |
| **Dungeon Master (DM)** | Campaign-scoped elevated role. Supreme control within their assigned campaign. Can manage all notes, folders, snapshots, recaps, and party members within that campaign. Assigned during campaign creation. Multiple DMs can exist per campaign. |
| **Campaign** | The root folder. Top-level container for all notes, journal sessions, recaps, connections, and snapshots belonging to one adventure or storyline. |
| **Campaign Owner** | The user who holds ownership of the Campaign root folder. If one DM exists, they are the Campaign Owner. If multiple DMs exist, the original creator is the Campaign Owner. Ownership transfers if the sole DM is reassigned to another user. |
| **Owner** | The user who created a specific note or folder. Has full control over their own creations — edit, rename, delete, move, and manage permissions. |
| **Granted** | A Party Member explicitly given elevated access to a note they did not create. Can view and edit content, but cannot rename, delete, or move it. Set by the Owner, DM, or Admin on a per-note basis. |
| **Party Member** | Any user added to a Campaign. Can create their own notes and journal entries. Has no edit rights over other users' content unless Granted. |
| **Party** | The full group of users assigned to a Campaign. Managed by the DM or Admin. |
| **Creator** | A permanent attribution marker on every note and folder showing who originally made it. Not a permission — purely informational. Displayed in the UI for transparency. |
| **Session** | A journal session within a Campaign. Groups journal entries by play session. Used as the unit for AI recap generation. |
| **Recap** | An AI-generated summary of a journal session. Available in Chronicle (narrative) or Summary (bullet point) style. Admins are unlimited, DMs get 3 per session, all others share 1 per session. |
| **Snapshot** | A saved point-in-time backup of a Campaign's full structure, notes, tags, and content. Non-destructive on restore — content created after the snapshot is preserved. Managed by DMs and Admins. |
| **Vault** | The section of the Admin Panel where Snapshots are stored, browsed, and restored. Accessible to Admins only. |
| **Graph** | The visual web of connected notes. Available in 2D and 3D modes. Each note appears as a Node, each relationship as a Connection. |
| **Node** | A single note as it appears in the Graph. Color-coded by category. |
| **Connection** | A link between two Notes in the Graph. Can carry a label describing the relationship. Created from the Note Editor or the Graph view. |
| **Path Finder** | A Graph tool that finds and highlights the shortest connection path between any two selected Notes. Available in both 2D and 3D modes. |
| **Tag** | A short identifier prefixed with `#` applied to a Note. Used to filter the sidebar. Multiple tags can be active simultaneously. Type `#` in the search bar to filter tags without affecting the note tree. |
| **Visibility** | The privacy setting on a Note or Folder. Options: Public (all users), Shared (party members), Private (owner and Granted users only). |
| **Trash** | Deleted notes are soft-deleted and moved to Trash rather than permanently removed. Restorable by the Owner or Admin. |
| **Recovered** | A Note restored from Trash. Marked with a ↩ indicator in the sidebar until cleared. |
| **Promote** | Converting a Journal entry into a full Note in the sidebar. Preserves the original text. |
| **DM Addition** | When a DM appends content to a Note they do not own, it is added as a visibly marked DM addition. The original author's text is never altered. |

---

### Technical / Self-Hosting

| Technical Term | Description |
|---|---|
| **Docker Volume** | The persistent storage container where the SQLite database and uploaded images live. Named `notesapp_chronicler_data`. Survives container restarts but is wiped by `docker compose down -v`. |
| **SQLite Database** | The single-file database (`dnd_notes.db`) storing all app data. Located in the Data Volume at `/data/dnd_notes.db` inside the container. |
| **WAL (Write-Ahead Log)** | SQLite's write-ahead log files (`dnd_notes.db-shm`, `dnd_notes.db-wal`). These exist alongside the main DB file during normal operation. Always back up all three files together. |
| **FTS (Full-Text Search)** | SQLite FTS5 virtual table powering note search. Indexes note titles and content. Search triggers at 3+ characters. `#` prefix routes to tag filtering instead. |
| **JWT (JSON Web Token)** | The authentication token issued on login. Valid for 7 days. `JWT_SECRET` is auto-generated on first boot and persisted in the data volume. Wiping the volume regenerates the secret and invalidates all sessions. |
| **Anthropic API Key** | The secret key used to authenticate AI recap requests. Stored only in the database. Never in source code, `.env` files, or Git. Stripped from all backup downloads. |
| **Cloudflare Tunnel** | The recommended method for exposing the app publicly over HTTPS without opening firewall ports. Runs via `cloudflared`. |
| **Auto-Migration** | Database schema changes that run automatically on container boot. New tables and columns are added safely without wiping existing data. No manual SQL required when updating. |
| **Backup Hash** | An MD5 checksum of the database file used by the automated backup cron job. Only saves a new backup if the hash differs from the previous two, keeping storage minimal. |
| **Cron Job** | Automated tasks running on the host VM. Two configured: nightly database backup (2am) and weekly Docker image cleanup (Sunday 3am). |
| **Symlink** | A symbolic link from the project directory to the Docker volume, used to access database and image files on the host if needed. |

---

## Roles & Permissions

### Role Hierarchy
```
Admin  >  DM  >  Owner  >  Granted  >  Default
```

### Permission Table

| Action | Admin | DM | Owner | Granted | Default |
|---|---|---|---|---|---|
| View all notes in campaign | ✅ | ✅ | ✅ | ✅ | Shared only |
| Create notes / folders | ✅ | ✅ | ✅ | ✅ | ✅ |
| Edit note content (full) | ✅ | Own notes only | ✅ | ✅ | ❌ |
| Append to another user's note | ✅ | ✅ (visibly marked) | ❌ | ❌ | ❌ |
| Rename note / folder | ✅ | ✅ | ✅ | ❌ | ❌ |
| Delete note / folder | ✅ | ✅ | ✅ | ❌ | ❌ |
| Move note / folder | ✅ | ✅ | ✅ | ❌ | ❌ |
| Manage note permissions | ✅ | ✅ | ✅ | ❌ | ❌ |
| Create / restore snapshots | ✅ | ✅ | ❌ | ❌ | ❌ |
| Edit another's journal entry | ✅ | ❌ | ❌ | ❌ | ❌ |
| Delete another's journal entry | ✅ | ❌ | ❌ | ❌ | ❌ |
| Manage DM roles | ✅ | ✅ | ❌ | ❌ | ❌ |
| Generate session recaps | ✅ unlimited | 3 per session | 1 per session | 1 per session | ❌ |
| Access Admin Panel | ✅ | ❌ | ❌ | ❌ | ❌ |

### Campaign Ownership Rules

| Scenario | Campaign Owner | DM Flags |
|---|---|---|
| Creator assigns themselves as sole DM | Creator | Creator |
| Creator assigns one other user as sole DM | New DM | New DM only — creator becomes Party Member |
| Creator assigns multiple DMs at creation | Creator | Creator + all assigned DMs |
| Second DM added later | Original DM | Original DM + new DM |

---

## Features

### Mobile
- Fully responsive — optimized for phones at ≤600px
- Installable as a PWA via "Add to Home Screen" (Android & iOS)
- Standalone mode — launches without browser chrome
- Bottom navigation bar, drawer sidebar, full-screen modals on mobile

### Notes & Folders
- Hierarchical folder/note tree with drag-and-drop reordering
- Categories with color-coded graph nodes (NPC, Location, Faction, Item, Quest, Lore, General)
- Tags with `#tag` search — tag bar always visible, multi-tag filtering
- Note visibility: public, shared, or private with per-user grants
- Full-text search (SQLite FTS5) — triggers at 3+ characters
- Note connections — link notes together for the knowledge graph
- Trash / soft-delete with restore
- **Sidebar list icons** (DM/admin): emoji presets or a small **uploaded** image (server-enforced size limits).

### Knowledge Graph
- 2D interactive graph (Cytoscape.js)
- 3D force graph (Three.js)
- Path Finder mode — shortest connection path between two notes
- Hop-based opacity — distant nodes fade out from selection
- Persistent campaign and layout settings

### Journal
- **DM prep checklist** (per session) — **✓ Prep** button in the session header opens a modal to add items, check off, and uncheck all; visible only to DMs and admins for that campaign
- **Session attendance** — **👥 Roll** in the session header opens a roster (present / absent / not marked); all party members can view, only DMs and admins can set marks
- Session-based entries with multi-user authorship
- Indent levels for nested discussion/debate
- Markdown keyboard shortcuts
- Promote a journal entry to a full note
- Move sessions between campaigns
- AI recap generation per session

### AI Features
- Session recap — Chronicle (narrative) or Summary (bullet point) style
- **Anthropic (cloud)** for recap text (Claude Haiku via Messages API)
- Per-role usage limits
- Admin-controlled toggle with API key management

### Admin Panel
Tabs: PARTY · VAULT · DEMO · AI · BACKUP · PASSWORD

- **PARTY** — create/delete users, toggle open registration
- **VAULT** — browse and restore campaign snapshots
- **DEMO** — generate or wipe demo campaign data
- **AI** — Anthropic API key for session recaps, test key, enable toggle
- **BACKUP** — download full database backup (API key stripped)
- **PASSWORD** — change admin password

---

## Mobile & PWA

The Chronicler is fully mobile-responsive and installable as a Progressive Web App (PWA) — no app store required.

### Installing on Android
1. Open the app in **Chrome**, **Edge**, or **Firefox**
2. Tap the browser menu → **"Add to Home Screen"** (Chrome may show an automatic install banner)
3. The app launches in standalone mode — no browser chrome, full screen

### Installing on iOS (iPhone / iPad)
1. Open the app in **Safari** (required — PWA install only works in Safari on iOS)
2. Tap the **Share button** (the box with an arrow at the bottom)
3. Scroll down and tap **"Add to Home Screen"**
4. Tap **Add** — the Chronicler icon appears on your home screen

### Mobile UI
- Full-screen standalone mode — no browser URL bar
- Bottom navigation bar for quick switching between Notes, Web, and Journal
- Sidebar opens as a slide-in drawer (hamburger ☰ button)
- All tap targets are minimum 44px — comfortable for fingers
- Modals are full-screen on small displays
- Horizontal scroll on metadata toolbars — no layout overflow

> **Note:** The app requires a network connection to function. Offline mode preserves the app shell but API calls require connectivity.

---

## AI Features

### Session recaps

- **Anthropic** — [Anthropic API](https://console.anthropic.com), billed per token (**not** included in Claude Pro). The server calls the Messages API with session journal context.

### Sidebar list icons (DM/admin)

- **Emoji presets** and **image upload** (small file, server-enforced limits). There is no built-in cloud image generation for icons.

### Cost estimates (Claude Haiku)
| Action | Approx. cost |
|---|---|
| Session recap (average session) | ~$0.005 |
| Campaign-wide summary | ~$0.01–0.05 |
| Monthly cost (weekly group, normal use) | < $1.00 |

### Setup
1. Sign up at [console.anthropic.com](https://console.anthropic.com)
2. Add credits (minimum $5 recommended)
3. Create an API key
4. In the app: **Admin Panel → AI tab**
5. Paste your key → **Save Key** → **⚡ Test Key**
6. Toggle AI Features on

> **Security:** Your API key is stored only in the SQLite database on your server. It is never in source code, `.env` files, or GitHub. Only the last 4 characters are displayed in the UI.

### Usage limits
| Role | Recaps per session |
|---|---|
| Admin | Unlimited |
| DM | 3 |
| Owner / Granted / Party Member | 1 (shared — first to generate locks out others) |

---

## Backups & Snapshots

### In-app Campaign Snapshots
- Hover a campaign folder in the sidebar → click 📷
- Optional **snapshot label** when saving (e.g. “Session 12 wrap”) — shown in the snapshot list and Admin VAULT
- Saves all notes, folders, tags, and content for that campaign
- **Non-destructive restore** — notes created after the snapshot are preserved, snapshot content is restored on top
- DMs and Admins only
- Up to 3 snapshots per campaign (oldest auto-purged)
- Admins have no cooldown limit; others limited to once per hour
- Accessible via **Admin Panel → VAULT**

### Full Database Backup
- **Admin Panel → BACKUP → ⬇ Download Backup**
- Full SQLite `.db` file with API key stripped
- Openable with [DB Browser for SQLite](https://sqlitebrowser.org/)
- Shows current DB size and last modified time

### Automated VM Backups (recommended cron setup)
Add to `crontab -e` on your host:

```bash
# Prune old Docker images every Sunday at 3am (keeps last 48h)
0 3 * * 0 docker image prune -a --filter "until=48h" -f >> /home/sysadmin/docker-prune.log 2>&1

# Smart daily DB backup — only saves if data changed, keeps 2 copies of each unique state, 90-day retention
0 2 * * * mkdir -p /home/sysadmin/backups && NEWDB=$(mktemp) && cp /var/lib/docker/volumes/notesapp_chronicler_data/_data/dnd_notes.db $NEWDB && NEWSUM=$(md5sum $NEWDB | cut -d' ' -f1) && LAST1=$(ls -t /home/sysadmin/backups/dnd_notes_*.db 2>/dev/null | sed -n '1p') && LAST2=$(ls -t /home/sysadmin/backups/dnd_notes_*.db 2>/dev/null | sed -n '2p') && SUM1=$([ -n "$LAST1" ] && md5sum "$LAST1" | cut -d' ' -f1 || echo "") && SUM2=$([ -n "$LAST2" ] && md5sum "$LAST2" | cut -d' ' -f1 || echo "") && if [ "$NEWSUM" != "$SUM1" ] || [ "$NEWSUM" != "$SUM2" ] || [ -z "$SUM2" ]; then cp $NEWDB /home/sysadmin/backups/dnd_notes_$(date +\%Y\%m\%d_%H%M).db; fi && rm -f $NEWDB && PROTECT=$(ls -t /home/sysadmin/backups/dnd_notes_*.db 2>/dev/null | head -2 | tr '\n' '|') && find /home/sysadmin/backups -name "dnd_notes_*.db" -mtime +90 | while read f; do echo "$PROTECT" | grep -qF "$(basename $f)" || rm -f "$f"; done
```

---

## Maintenance

### Check status
```bash
docker compose ps
docker compose logs --tail=50
```

### Restart
```bash
cd ~/notesapp && docker compose restart
```

### Rebuild (e.g. after updating)
```bash
cd ~/notesapp && docker compose up -d --build
```
Your data lives in a Docker volume and is not removed when you rebuild. The database and uploaded images persist across restarts.

### Full wipe and fresh start
```bash
cd ~/notesapp && docker compose down -v && docker compose up -d --build
```
> ⚠️ Destroys all data. Back up first.

### Fix volume permissions after a wipe
```bash
sudo chmod o+rx /var/lib/docker /var/lib/docker/volumes /var/lib/docker/volumes/notesapp_chronicler_data
sudo chown -R sysadmin:sysadmin /var/lib/docker/volumes/notesapp_chronicler_data/_data
```

---

## Updating

1. On your server, pull the latest version:
   ```bash
   cd ~/notesapp && git pull origin main
   ```
2. Rebuild and restart:
   ```bash
   docker compose up -d --build
   ```

**Data safety:** Rebuilding the container does **not** delete your data. The database and uploaded images live in a Docker volume that persists across rebuilds. Data is only lost if you run `docker compose down -v` (which removes volumes).

Database migrations run automatically on boot. No manual SQL needed. Admins may see an in-app update alert in the Admin Panel when a newer release is available; the alert is informational only (no auto-update button).

---

## Troubleshooting

### Bad Gateway / Error 502 / Cloudflare 1033
Backend container is down. Check:
```bash
docker compose logs --tail=50
```

### High CPU/RAM during deploy — VM freezes
The React build is memory-intensive. Increase VM RAM to 4GB minimum before rebuilding.

### Lost admin password
```bash
docker compose exec dnd-chronicler node -e "
const db = require('./backend/db/database');
const bcrypt = require('bcryptjs');
const hash = bcrypt.hashSync('newpassword', 12);
db.prepare('UPDATE users SET password_hash = ?, force_password_change = 1 WHERE username = ?').run(hash, 'admin');
console.log('Done');
"
```

### Everyone logged out after container restart
The entrypoint auto-generates and persists `JWT_SECRET` in the data volume. If the volume was wiped (`docker compose down -v`), a new secret is generated and all sessions are invalidated. See Configuration.

### Can't access database files in the volume
Run the permission fix commands in the Maintenance section for the volume path that matches your install.

### Snapshot restore not working
Take a fresh snapshot after updating to the latest version — old snapshots taken before update 62 may be missing the root folder in their saved data.

---

## Stack

| Layer | Technology |
|---|---|
| Backend | Node.js + Express |
| Database | SQLite (better-sqlite3) |
| Search | SQLite FTS5 |
| Frontend | React + Vite |
| Graph 2D | Cytoscape.js |
| Graph 3D | 3d-force-graph + Three.js |
| Auth | JWT + bcryptjs |
| Real-time | WebSockets |
| AI | Anthropic (Claude Haiku) for session recaps |
| Images | multer |
| Mobile / PWA | Web App Manifest + Service Worker |
| Container | Docker + Docker Compose |
| Tunnel | Cloudflare Tunnel (optional) |

---

*The Chronicler — built for adventurers, run by dungeon masters.*
