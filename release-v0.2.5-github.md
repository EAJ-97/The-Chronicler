## The Chronicler v0.2.5

### Highlights

- **AI campaign tools (DM):** Lore So Far (journal), NPC / location / item generators, and campaign continuity reports, backed by new `/ai/*` routes and a shared corpus builder (`aiCorpus` / `aiPrompts`) with visibility-aware note and journal context.
- **Note editor — bottom drawer:** Safer expanded height (`clamp(300px, 58vh, 680px)`), tab bar safe-area padding, and **connection / tag suggestion lists** rendered with **`createPortal` to `document.body`** and **fixed** positioning above the search fields so suggestions are no longer clipped by drawer overflow or hidden behind the note body.

### Technical notes

- Database: migration for AI lore cache (see `backend/db/database.js`).
- New backend: `backend/routes/aiTools.js`, `backend/utils/aiCorpus.js`, `backend/utils/aiPrompts.js`; wired in `backend/server.js`.
- Frontend: updates to `Journal.jsx`, `NoteEditor.jsx`, `Dashboard.jsx`; README adjusted for AI-related configuration and behavior.

### Upgrade

Pull `main`, rebuild containers (`./deploy.sh` for production per project workflow), and ensure AI-related env vars are set if you use those features.

### Full changelog (this release)

- AI: lore cache, DM generators, continuity, corpus + prompts, strict visibility checks.
- Notes UI: bottom drawer height and connection/tag autocomplete layering fix (viewport-portaled dropdowns).
