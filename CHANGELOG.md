# Changelog

All notable changes to The Chronicler (notesapp). Newest first.

## Unreleased

### Fixed
- Entrypoint ignores `replace-me*` JWT_SECRET placeholders and falls back to `/data/.jwt_secret`
- `.env.example` leaves `JWT_SECRET` empty so copying it cannot override the volume secret

### Changed
- Synced template fixes: secret-output rules, maintenance drift check, deploy fetches only main

### Added
- DevOps kit: scripts/deploy.sh, scripts/backup.sh, CI, Dependabot
- `/health` liveness endpoint and compose healthcheck
- Legacy `./deploy.sh` now wraps `scripts/deploy.sh`

## Incidents

### 2026-11-02 — placeholder JWT_SECRET active on production
- **What broke:** From about 19:11 CT until ~21:00 CT, the app signed tokens with the `.env.example` placeholder instead of `/data/.jwt_secret`.
- **Impact:** Anyone who knew the placeholder could forge login JWTs on the public site; existing sessions from before 19:11 were invalidated until the hotfix.
- **Cause:** Onboarding created `.env` by copying `.env.example` and added `env_file: .env` to compose; the entrypoint only used the volume secret when `JWT_SECRET` was empty.
- **Fix:** Blanked `JWT_SECRET` in `.env` and recreated the container (hotfix). Entrypoint now treats `replace-me*` as unset; `.env.example` documents leaving it empty.
