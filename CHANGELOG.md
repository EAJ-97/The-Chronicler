# Changelog

All notable changes to The Chronicler (notesapp). Newest first.

## Unreleased

### Fixed
- Glossary AI scan: read `text` content blocks after Haiku 5.5 `thinking`; brace-extract JSON; map type synonyms; raise max_tokens
- Glossary AI scan: omit `temperature` (Haiku 5.5 rejects it); show scan/build-from-past status and real API errors
- Session recap prompts use the real `session_number` / title instead of folder session count
- Entrypoint ignores `replace-me*` JWT_SECRET placeholders and falls back to `/data/.jwt_secret`
- `.env.example` leaves `JWT_SECRET` empty so copying it cannot override the volume secret

### Changed
- AI recaps: Chronicle stays story-like but session-journal-only; Summary stays factual; tone-based temperature; Player labels and spelling/attribution fidelity rules
- Recap user prompt order is `<glossary>` then `<journal>` then the Write… line; model via `RECAP_MODEL`
- Synced template fixes: secret-output rules, maintenance drift check, deploy fetches only main

### Added
- Top-level Glossary (one per World or standalone Campaign): locked tree doc, CRUD, suggestions, merge-on-move, Haiku 5.5 scan (`GLOSSARY_SCAN_MODEL`), `played_by` on NPC notes
- Editable session recaps (PUT `/api/recaps/:id` for author/DM/admin; Edit/Save in RecapViewer; no quota burn)
- Recap source confirmation (`GET /api/recaps/sources/:sessionId` + UI line showing session + journal entry count)
- DevOps kit: scripts/deploy.sh, scripts/backup.sh, CI, Dependabot
- `/health` liveness endpoint and compose healthcheck
- Legacy `./deploy.sh` now wraps `scripts/deploy.sh`

## Incidents

### 2026-11-02 — placeholder JWT_SECRET active on production
- **What broke:** From about 19:11 CT until ~21:00 CT, the app signed tokens with the `.env.example` placeholder instead of `/data/.jwt_secret`.
- **Impact:** Anyone who knew the placeholder could forge login JWTs on the public site; existing sessions from before 19:11 were invalidated until the hotfix.
- **Cause:** Onboarding created `.env` by copying `.env.example` and added `env_file: .env` to compose; the entrypoint only used the volume secret when `JWT_SECRET` was empty.
- **Fix:** Blanked `JWT_SECRET` in `.env` and recreated the container (hotfix). Entrypoint now treats `replace-me*` as unset; `.env.example` documents leaving it empty.
