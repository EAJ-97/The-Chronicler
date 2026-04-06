# The Chronicler v1.0.0 — First deployment

This is the **first production deployment** release: a stable baseline for self-hosted Chronicler instances (Docker), with the features and fixes merged through `dev` into `main` at tag **`v1.0.0`**.

## Highlights

- **Production-ready baseline:** Version **1.0.0** in app packages; deploy with **`./deploy.sh`** from `main` per project workflow.
- **DM / AI tools:** NPC, location, and item generators; continuity reports; Lore So Far; player lore summary for completed scopes; **`@` mention suggestions** in DM AI prompt fields (with keyboard accept).
- **Campaign completion:** Mark world/campaign roots complete; archive-aware UI on notes, graph, and journal; completion checkbox state fixes when merging API responses.
- **Web & journal:** Graph “completed campaign” banner placed below the campaign picker; journal read-only when archived (server + UI), including mobile submit/indent.
- **Integrity:** Campaign integrity scan (DM/admin) from the top bar.
- **Timeline:** Hidden behind `SHOW_TIMELINE_TAB` in `Dashboard.jsx` (implementation kept in `TimelineView.jsx`).
- **UI fixes:** Stray **`0`** renders from SQLite numeric flags in JSX (`!!` guards for `is_admin`, `ai_enabled`, `is_folder`, etc.).

## Deploy

1. On the server: `git checkout main && git pull origin main`
2. Run **`./deploy.sh`** (rebuilds production; enforces branch and merge checks).

## Requirements

- Docker / Compose as documented in **README.md**
- Secrets (JWT, AI keys) via **`.env`** or Admin — never commit secrets

---

*Tag: `v1.0.0` — use this file as the GitHub release description (see commands below).*
