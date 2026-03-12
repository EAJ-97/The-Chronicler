#!/bin/sh

# Production deploy guard.
# Verifies the local working tree exactly matches origin/main on GitHub
# before rebuilding and restarting the production container.
#
# Checks (all must pass):
#   1. Currently on the main branch
#   2. No uncommitted or unstaged changes
#   3. Local HEAD matches origin/main (nothing unpushed, nothing behind)
#
# Usage: ./deploy.sh

set -e

BRANCH=$(git rev-parse --abbrev-ref HEAD)
REMOTE="origin/main"

echo "[deploy] Fetching latest state from GitHub..."
git fetch origin

# Check 1: must be on main
if [ "$BRANCH" != "main" ]; then
  echo ""
  echo "  ERROR: You are on branch '$BRANCH', not main."
  echo "  Switch to main before deploying: git checkout main"
  echo ""
  exit 1
fi

# Check 2: no uncommitted or unstaged changes
if [ -n "$(git status --porcelain)" ]; then
  echo ""
  echo "  ERROR: Working tree is dirty (uncommitted changes present)."
  echo "  Commit or stash your changes before deploying."
  echo ""
  git status --short
  echo ""
  exit 1
fi

# Check 3: local HEAD must match origin/main exactly
LOCAL=$(git rev-parse HEAD)
REMOTE_SHA=$(git rev-parse origin/main)

if [ "$LOCAL" != "$REMOTE_SHA" ]; then
  echo ""
  echo "  ERROR: Local main does not match origin/main on GitHub."
  echo "  Local:  $LOCAL"
  echo "  Remote: $REMOTE_SHA"
  echo ""
  echo "  If you have unpushed commits: git push origin main"
  echo "  If you are behind: git pull origin main"
  echo ""
  exit 1
fi

echo "[deploy] All checks passed."
echo "[deploy] Deploying commit $(git rev-parse --short HEAD) — $(git log -1 --format='%s')"
echo ""

docker compose up -d --build

echo ""
echo "[deploy] Production container rebuilt and running."
