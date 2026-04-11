# The Chronicler v1.1.0 — Release notes

**Release tag:** `v1.1.0`  
**Focus:** Campaign building — world/campaign root folder UX (tabbed tools + DM-only notes column).

---

## Summary

This release improves **world and standalone campaign root folders** (not nested subfolders): DM tools and appearance are organized into **tabs** (Icons, AI tools, Continuity), and DMs/admins get a **split main editor** — party-visible overview on the left, **DM-only notes** on the right. Players continue to see only the party-facing text.

---

## Database

- **Migration `041_notes_folder_dm_content`:** adds nullable column `notes.folder_dm_content` (DM-only markdown for world/campaign root folders).
- Existing installs apply the migration automatically on next backend start.

---

## Backend

- **`isWorldOrCampaignRootFolder`** moved to [`backend/utils/access.js`](backend/utils/access.js); reused by [`backend/routes/aiTools.js`](backend/routes/aiTools.js) (removed duplicate helper).
- **`GET /api/notes/:id`:** strips `folder_dm_content` for users who are not DM/admin of that folder.
- **`PUT /api/notes/:id`:** accepts `folder_dm_content` for eligible root folders; conflict responses include `server_folder_dm_content` when relevant.
- **[`backend/utils/chroniclerBackup.js`](backend/utils/chroniclerBackup.js):** import includes `folder_dm_content` on note insert.

---

## Frontend

- **[`frontend/src/components/NoteEditor.jsx`](frontend/src/components/NoteEditor.jsx):**
  - Tab bar under the toolbar: **Icons** | **AI tools** | **Continuity** (visibility rules unchanged from the previous inline sections).
  - **Nested subfolders:** Chronicle appearance remains a single inline block (not tabbed).
  - **DM/admin on root folders:** two-column edit/view — **Party-visible overview** + **DM notes (hidden from players)**; stacked on mobile.
  - Conflict modal extended when both bodies conflict.

---

## Upgrade notes

1. Deploy/restart the app so migration **041** runs.
2. No manual SQL required for standard upgrades.
3. After deploy, confirm `/api/version` shows the new Git commit (if `GIT_COMMIT` is passed at build time).

---

## Full changelog (commits)

- `feat(campaign): tabbed root tools and split DM folder content` — main feature (branch `feature/campaign-building` merged via `dev`).

---

*Copy this file into GitHub Releases description or internal comms as needed.*
