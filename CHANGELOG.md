# Changelog

All notable changes to The Chronicler (notesapp). Newest first.

## Unreleased

### Fixed
- Native `<select>` open lists: dark `color-scheme` + option backgrounds so pale theme text stays readable
- Recap reader on mobile: full-width text, version menu when multiple exist, Read/Edit toggle, top-right X to close
- Glossary: Edit is prominent on approved entries; suggestion Edit (editors) includes name/type/description/aliases
- Recap edit 500: ensure `recaps.updated_at` exists (migration 050 used illegal `DEFAULT CURRENT_TIMESTAMP` on `ADD COLUMN`, failed silently, and was still marked done)
- Boot crash from follow-up migration that repeated the same illegal default

### Added
- Main tabs keep-alive (Notes / Web / Journal / Timeline stay mounted); last tab restored from localStorage
- Journal session tab bar (chips or hamburger when many / on mobile); one session at a time; compose only on the current session
- Per-note `hide_from_graph` toolbar toggle (GRAPH / NO GRAPH): stays in tree and search, excluded from knowledge graph nodes and edges
- Delete session recap (DELETE `/api/recaps/:id`) for campaign DM or admin; refunds one generation toward the author; Delete button in RecapViewer

### Changed
- AI chronicle: three-step pipeline (extract scenes JSON → write with Opus → verify + one revision); summary stays single-step; `RECAP_EXTRACT_MODEL` / `RECAP_WRITE_MODEL` / `RECAP_VERIFY_MODEL`; `verify_report` column (API + UI only when `RECAP_DEBUG=1`)
- AI recaps: app-assembled markdown title (`# Chronicle/Summary of…`), optional `*Session N*`, model `##` subtitle; chronicle style sample + STYLE rules; full-page themed markdown reader with Edit/Save
- AI recaps: user payload is `<session>` → `<party>` → `<glossary>` → `<journal>` (authorship groups, local date headers via `APP_TIMEZONE`, quote tags); default `RECAP_MODEL=claude-sonnet-5-5`; `RECAP_DEBUG`; shared `modelSupportsTemperature` allowlist for recaps + glossary scan
- AI recaps: Chronicle covers every scene (roughly one paragraph per 2–4 scenes); Summary stays 200–350 words and covers every scene briefly
- Synced template fixes: secret-output rules, maintenance drift check, deploy fetches only main

### Fixed
- Recaps/AI tools: read `text` content blocks after Sonnet/Haiku 5.5 `thinking` (was Empty response from AI)
- Character `played_by`: autosave used a stale value (never persisted); dropdown now includes the logged-in user
- Glossary AI scan: read `text` content blocks after Haiku 5.5 `thinking`; brace-extract JSON; map type synonyms; raise max_tokens
- Glossary AI scan: omit `temperature` (Haiku 5.5 rejects it); show scan/build-from-past status and real API errors
- Session recap prompts use the real `session_number` / title instead of folder session count
- Entrypoint ignores `replace-me*` JWT_SECRET placeholders and falls back to `/data/.jwt_secret`
- `.env.example` leaves `JWT_SECRET` empty so copying it cannot override the volume secret

### Added
- Top-level Glossary (one per World or standalone Campaign): locked tree doc, CRUD, suggestions, merge-on-move, Haiku 5.5 scan (`GLOSSARY_SCAN_MODEL`), `played_by` on NPC notes
- Editable session recaps (PUT `/api/recaps/:id` for author/DM/admin; Edit/Save in RecapViewer; no quota burn)
- Recap source confirmation (`GET /api/recaps/sources/:sessionId` + UI line showing session + journal entry count)
- DevOps kit: scripts/deploy.sh, scripts/backup.sh, CI, Dependabot
- `/health` liveness endpoint and compose healthcheck
- Legacy `./deploy.sh` now wraps `scripts/deploy.sh`

## Incidents

### 2026-11-11 — recap edit 500, then brief boot loop
- **What broke:** Saving a recap returned 500 (`no such column: updated_at`). A fix deploy then crash-looped the container for a few minutes.
- **Impact:** Recap edits failed until the column was added; site was down briefly (~3–4 minutes) during the failed migration boot loop.
- **Cause:** Migration 050 used `ALTER TABLE … ADD COLUMN updated_at … DEFAULT CURRENT_TIMESTAMP`. SQLite rejects non-constant defaults on `ADD COLUMN`; the error was swallowed and the migration was still marked done. The follow-up ensure migration repeated the same illegal default and aborted boot.
- **Fix:** Add `updated_at` as a nullable column, then backfill from `created_at` (#30 / #31).

### 2026-11-02 — placeholder JWT_SECRET active on production
- **What broke:** From about 19:11 CT until ~21:00 CT, the app signed tokens with the `.env.example` placeholder instead of `/data/.jwt_secret`.
- **Impact:** Anyone who knew the placeholder could forge login JWTs on the public site; existing sessions from before 19:11 were invalidated until the hotfix.
- **Cause:** Onboarding created `.env` by copying `.env.example` and added `env_file: .env` to compose; the entrypoint only used the volume secret when `JWT_SECRET` was empty.
- **Fix:** Blanked `JWT_SECRET` in `.env` and recreated the container (hotfix). Entrypoint now treats `replace-me*` as unset; `.env.example` documents leaving it empty.
