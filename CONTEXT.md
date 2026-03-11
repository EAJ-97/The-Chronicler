# The Chronicler — Project Context
> Paste this at the start of a new Claude session to resume work.

---

## What This Is
A self-hosted D&D party notes app. Dark fantasy aesthetic. Built for tabletop groups to share notes, journal sessions, build knowledge graphs, and generate AI recaps. Single-file SQLite database, Docker deployed.

---

## Stack
| Layer | Tech |
|---|---|
| Backend | Node.js + Express |
| Database | SQLite (better-sqlite3) + FTS5 |
| Frontend | React + Vite |
| Graph 2D | Cytoscape.js |
| Graph 3D | 3d-force-graph + Three.js |
| Auth | JWT (7-day) + bcryptjs |
| Real-time | WebSockets |
| AI | Anthropic API (Claude Haiku) |
| Images | multer |
| Container | Docker + Docker Compose |
| Tunnel | Cloudflare Tunnel |

---

## Infrastructure
- **VM IP:** `192.168.10.145`, SSH user: `sysadmin`
- **App dir:** `~/notesapp/`
- **Container name:** `dnd-chronicler`
- **Port:** `3001`
- **DB volume:** `notesapp_chronicler_data` → `/data/dnd_notes.db`
- **Host DB path:** `/var/lib/docker/volumes/notesapp_chronicler_data/_data/dnd_notes.db`
- **Public URL:** `https://notes.ejhomelabs.me` via Cloudflare Tunnel
- **SSH:** Passwordless via ed25519 key

---

## Deploy Pattern
```powershell
# Copy files to VM
scp file sysadmin@192.168.10.145:~/notesapp/path/

# Rebuild (no data loss)
ssh sysadmin@192.168.10.145 "cd ~/notesapp && docker compose up -d --build"

# Full wipe (destroys data)
ssh sysadmin@192.168.10.145 "cd ~/notesapp && docker compose down -v && docker compose up -d --build"
```

---

## DB Schema (key tables)
```sql
users           -- id, username, password_hash, is_admin, is_demo, force_password_change
notes           -- id, user_id, parent_id, title, content, is_folder, category, tags (via note_tags),
                --   visibility, is_demo, significance, narrative_weight, deleted_at, recovered
sessions        -- id, folder_id, created_at, is_demo
journal_entries -- id, user_id, folder_id, session_id, content, indent_level, sort_order
settings        -- key/value: registration_open, demo_seeded, ai_enabled, ai_api_key
folder_roles    -- folder_id, user_id, role ('dm')
recaps          -- id, session_id, folder_id, generated_by, tone, content, is_dm_only, created_at
recap_usage     -- session_id, user_id, count
folder_snapshots -- folder_id, saved_by, saved_at, snapshot_json
connections     -- source_note_id, target_note_id, label, created_by
note_tags       -- note_id, tag
note_permissions -- note_id, user_id
note_images     -- id, note_id, filename, uploaded_by
```

---

## File Structure
```
notesapp/
├── backend/
│   ├── server.js
│   ├── db/
│   │   ├── database.js       # schema + migrations (run on boot)
│   │   └── demoSeeder.js
│   └── routes/
│       ├── notes.js
│       ├── connections.js
│       ├── journal.js
│       ├── recaps.js
│       ├── snapshots.js
│       ├── images.js
│       ├── admin.js
│       └── auth.js
├── frontend/
│   └── src/
│       ├── App.jsx
│       ├── api.js
│       └── components/
│           ├── Dashboard.jsx     # main shell, loads all data
│           ├── NoteList.jsx      # sidebar tree
│           ├── NoteEditor.jsx    # note edit/view panel
│           ├── Journal.jsx       # session journal
│           ├── GraphView.jsx     # 2D graph
│           ├── GraphView3D.jsx   # 3D graph
│           ├── AdminPanel.jsx    # admin modal (tabs below)
│           ├── RecapViewer.jsx   # AI recap modal
│           ├── SnapshotPanel.jsx # snapshot modal
│           ├── TrashPanel.jsx
│           ├── MoveModal.jsx
│           ├── PromoteModal.jsx
│           └── NotePanel.jsx     # graph side panel
├── docker-compose.yml
└── Dockerfile
```

---

## Admin Panel Tabs
`PARTY | VAULT | DEMO | AI | BACKUP | PASSWORD`

---

## Completed Updates (1–62)

### Core (1–40)
Full notes CRUD, folder tree, drag/drop, categories, tags, FTS search, visibility/permissions, connections, 2D/3D graph, path finder, JWT auth, admin panel, demo seeder, trash/restore, significance/narrative weight fields, image uploads, markdown editor, move modal, promote journal→note, session management.

### Updates 41–56
Graph hop-based opacity, persistent layout/campaign settings, 3D graph improvements, NotePanel side panel, sort order drag/drop fixes, private folder cascade visibility, ancestor surfacing in note tree, bulk tag/grant loading optimization, tag autocomplete, undo/redo in editor, markdown help panel, beforeunload save.

### Update 57 — Journal Empty Bug + Tag Improvements
- Demo seeder fixed to use root folder IDs for journal entries
- Tag bar max ~4 rows with scrollbar
- `#` search filters tag bar only, never the tree

### Update 58 — Search/Tag Interaction Overhaul
- Multi-tag selection (Set-based)
- Tags act as pre-filter scope; search box turns gold with SCOPED badge
- Search triggers at 3+ chars frontend-side (backend min 1)
- Hover tooltip on truncated sidebar titles (600ms delay)

### Update 59 — AI Framework
- DB settings: `ai_enabled`, `ai_api_key`
- Admin Panel → AI tab: toggle, API key input, masked display, ⚡ TEST KEY, REMOVE
- Backend routes: `/api/admin/ai/*`
- Key stored in DB only, never returned to frontend, stripped from backups
- Model: Claude Haiku 4.5

### Update 60 — Session Recap System + DM Roles
- New tables: `folder_roles`, `recaps`, `recap_usage`
- DM role: campaign-scoped, root folder creator auto-assigned on creation
- Recap usage limits: Admin=unlimited, DM=3/session, others share 1/session
- ✦ RECAP button per session in journal header
- RecapViewer modal: tone picker (Chronicle/Summary), generate, sidebar recap list
- WebSocket `recap_generated` event

### Update 61 — Admin Backup Download
- `GET /admin/backup/download` — WAL checkpoint, scrubs API key, streams .db file
- `GET /admin/backup/info` — DB size + last modified
- Admin Panel → BACKUP tab

### Update 62 — Snapshot Restore Fixes
- Root folder now included in snapshot (was missing)
- Topological sort so parents inserted before children
- `defer_foreign_keys` moved outside transaction (better-sqlite3 requirement)
- Per-node try/catch with error logging
- WebSocket broadcast after restore
- Debug route: `GET /snapshots/:folderId/inspect/:snapshotId` (admin only)
- Admin exempt from 1-hour snapshot cooldown

---

## Current State (end of update 62)
- App is live at `https://notes.ejhomelabs.me`
- Snapshot restore being tested after update 62 fixes
- Admin password not yet changed from default `admin/admin`

---

## Permissions Model (agreed, not yet built — next is update 63)
This was fully designed and agreed upon. Build it next.

### Role Hierarchy
```
Admin > DM > Owner > Granted > Default
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
| Generate recaps | ✅ unlimited | 3/session | 1/session | 1/session | ❌ |

### Campaign Ownership Rules
| Scenario | Campaign Owner | DM Flags |
|---|---|---|
| Creator assigns themselves as sole DM | Creator | Creator |
| Creator assigns one other as sole DM | New DM | New DM only — creator becomes Party Member |
| Creator assigns multiple DMs | Creator | Creator + all assigned DMs |
| Second DM added later | Original DM | Original DM + new DM |

### DM Append Behavior
When a DM adds content to a note they don't own, it is appended with a visible marker:
```
---
*⚔ DM Addition by [username] — [date]:*
[their content]
```
Original author's text is never modified.

### Files to modify for update 63
**Backend:**
- `backend/routes/notes.js` — add `getRootFolderId`, `isDMOf`, `isGrantedUser` helpers; new `GET /meta/my-dm-campaigns` route; DM campaign notes in `GET /`; split `PUT /:id` into canFullEdit/canManage/canAppend tiers; append_content field; update DELETE, restore, clear-recovered, sync-visibility
- `backend/routes/connections.js` — DM can edit/delete connections in their campaign
- `backend/routes/snapshots.js` — `canManageFolder` checks DM role not ownership
- `backend/routes/images.js` — DM can delete images on notes in their campaign

**Frontend:**
- `frontend/src/components/Dashboard.jsx` — fetch `my-dm-campaigns`, pass `dmCampaignIds` to NoteList/NoteEditor/SnapshotPanel
- `frontend/src/components/NoteList.jsx` — `isDM` per node (walk to campaign root, check dmCampaignIds); `canManage = admin || owner || isDM`; hide private lock icon for DM
- `frontend/src/components/NoteEditor.jsx` — full isOwner/isGranted/isDM/canFullEdit/canManage/canAppend model; DM append UI at bottom of editor
- `frontend/src/components/SnapshotPanel.jsx` — canManage checks dmCampaignIds

---

## Cron Jobs (sysadmin crontab on VM)
```bash
# Weekly Docker image prune
0 3 * * 0 docker image prune -a --filter "until=48h" -f >> /home/sysadmin/docker-prune.log 2>&1

# Daily smart DB backup
0 2 * * * mkdir -p /home/sysadmin/backups && NEWDB=$(mktemp) && cp /var/lib/docker/volumes/notesapp_chronicler_data/_data/dnd_notes.db $NEWDB && NEWSUM=$(md5sum $NEWDB | cut -d' ' -f1) && LAST1=$(ls -t /home/sysadmin/backups/dnd_notes_*.db 2>/dev/null | sed -n '1p') && LAST2=$(ls -t /home/sysadmin/backups/dnd_notes_*.db 2>/dev/null | sed -n '2p') && SUM1=$([ -n "$LAST1" ] && md5sum "$LAST1" | cut -d' ' -f1 || echo "") && SUM2=$([ -n "$LAST2" ] && md5sum "$LAST2" | cut -d' ' -f1 || echo "") && if [ "$NEWSUM" != "$SUM1" ] || [ "$NEWSUM" != "$SUM2" ] || [ -z "$SUM2" ]; then cp $NEWDB /home/sysadmin/backups/dnd_notes_$(date +\%Y\%m\%d_%H%M).db; fi && rm -f $NEWDB && PROTECT=$(ls -t /home/sysadmin/backups/dnd_notes_*.db 2>/dev/null | head -2 | tr '\n' '|') && find /home/sysadmin/backups -name "dnd_notes_*.db" -mtime +90 | while read f; do echo "$PROTECT" | grep -qF "$(basename $f)" || rm -f "$f"; done
```

---

## VS Code Setup
- Workspace file: `~/notesapp/chronicler.code-workspace`
- Data symlink: `~/notesapp/data -> /var/lib/docker/volumes/notesapp_chronicler_data/_data`
- Systemd service auto-chowns volume on boot: `/etc/systemd/system/chronicler-perms.service`

---

## Feature Roadmap (remaining)
| Priority | Feature |
|---|---|
| 🔴 Next | Update 63 — full permissions model (see above) |
| 🔴 Next | Campaign creation flow — DM picker + party member selection modal |
| 🟡 Soon | Note templates (NPC / location / faction etc.) |
| 🟡 Soon | Campaign management UI (DM role management) |
| ⚪ Later | Mobile layout overhaul |
| ⚪ Later | Note version history / diff |
| ⚪ Later | Note locking |
| ⚪ Later | Recently changed sort view |
| ⚪ Later | Relationship types on graph edges |
| ⚪ Later | Timeline view |
| ⚪ Later | Export (PDF / Markdown) |
| ⚪ Later | Dice roller (logs to journal) |
| ⚪ Later | Pinned / starred notes |
| ⚪ Later | Docker one-liner + setup wizard |
| ⚪ Later | "What did we forget" AI campaign analysis |
