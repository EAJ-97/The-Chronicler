#!/usr/bin/env bash
# scripts/deploy.sh: deploy the latest main, verify it is healthy, roll back if not.
# Usage (from anywhere): ~/<project>/scripts/deploy.sh
#
# Steps:
#   1. Refuse to run with uncommitted changes
#   2. Pull main from GitHub (fast-forward only)
#   3. Rebuild and restart the containers
#   4. Wait until every container is running (and healthy, if it has a healthcheck)
#   5. Success: tag the commit deploy-YYYYMMDD-HHMMSS and log it to .deploy-log
#      Failure: show logs, switch back to the previous commit, rebuild, exit 1
set -euo pipefail

cd "$(dirname "$0")/.."              # run from the project root, wherever we were called from
PROJECT="$(basename "$PWD")"
TIMEOUT="${DEPLOY_TIMEOUT:-120}"      # seconds to wait for healthy containers

# --- 1. Safety checks ------------------------------------------------------
[[ -f .env ]] || { echo "No .env file. Create it from .env.example first."; exit 1; }
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Uncommitted changes in $PROJECT. Commit or stash them before deploying."
  exit 1
fi

PREV="$(git rev-parse HEAD)"

# --- 2. Get the latest main -------------------------------------------------
if git remote get-url origin >/dev/null 2>&1; then
  git fetch --quiet origin main
  git checkout --quiet main
  git merge --ff-only --quiet origin/main || {
    echo "Local main has commits that are not on GitHub. Not deploying; push or fix them first."
    exit 1
  }
fi
NEW="$(git rev-parse HEAD)"
echo "Deploying $PROJECT: ${PREV:0:7} -> ${NEW:0:7}"

# --- 3. Rebuild and restart -------------------------------------------------
docker compose config --quiet
docker compose up -d --build --remove-orphans

# --- 4. Wait for health -----------------------------------------------------
# Only services defined in the active compose file(s). A service passes if its
# container is running and its healthcheck (if any) says healthy. Stopped
# containers from other compose files in the same project are ignored.
all_healthy() {
  local svc id state health
  for svc in $(docker compose config --services); do
    id="$(docker compose ps -a -q "$svc")"
    [[ -n "$id" ]] || return 1
    state="$(docker inspect -f '{{.State.Status}}' "$id")"
    health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id")"
    [[ "$state" == running ]] || return 1
    [[ "$health" == healthy || "$health" == none ]] || return 1
  done
}

echo "Waiting up to ${TIMEOUT}s for containers to be healthy..."
sleep 10                              # give apps without a healthcheck a moment to crash if they will
ok=no
for (( waited=10; waited<=TIMEOUT; waited+=5 )); do
  if all_healthy; then ok=yes; break; fi
  sleep 5
done

# --- 5. Success or rollback -------------------------------------------------
if [[ "$ok" == yes ]]; then
  TAG="deploy-$(date +%Y%m%d-%H%M%S)"
  git tag "$TAG"
  git push --quiet origin "$TAG" 2>/dev/null || true
  echo "$(date '+%F %T') ok ${NEW:0:7} $TAG" >> .deploy-log
  echo "OK: $PROJECT is healthy on ${NEW:0:7} ($TAG)"
  exit 0
fi

echo "FAILED: $PROJECT did not become healthy. Recent logs:"
docker compose ps
docker compose logs --tail=40
echo "$(date '+%F %T') FAILED ${NEW:0:7}" >> .deploy-log

if [[ "$PREV" != "$NEW" ]]; then
  echo "Rolling back to ${PREV:0:7}..."
  git checkout --quiet --detach "$PREV"
  docker compose up -d --build --remove-orphans
  echo "$(date '+%F %T') rolled-back-to ${PREV:0:7}" >> .deploy-log
  echo "Rolled back. The server runs ${PREV:0:7}; main still has the broken change. Fix forward with a new PR, then deploy again."
else
  echo "Nothing to roll back to (this was the first deploy of this commit)."
fi
exit 1
