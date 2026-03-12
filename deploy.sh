#!/bin/sh

# Production deploy guard.
# Enforces the full branch workflow before rebuilding the production container:
#
#   feature/* or bugfix/*  →  dev  →  main  →  ./deploy.sh
#
# Checks (all must pass):
#   1. Currently on the main branch
#   2. No uncommitted or unstaged changes
#   3. Local HEAD matches origin/main on GitHub (nothing unpushed, nothing behind)
#   4. origin/dev is fully merged into origin/main (dev was not bypassed)
#
# Usage: ./deploy.sh

set -e

BRANCH=$(git rev-parse --abbrev-ref HEAD)

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
REMOTE_MAIN=$(git rev-parse origin/main)

if [ "$LOCAL" != "$REMOTE_MAIN" ]; then
  echo ""
  echo "  ERROR: Local main does not match origin/main on GitHub."
  echo "  Local:  $LOCAL"
  echo "  Remote: $REMOTE_MAIN"
  echo ""
  echo "  If you have unpushed commits: git push origin main"
  echo "  If you are behind:            git pull origin main"
  echo ""
  exit 1
fi

# Check 4: origin/dev must be fully merged into origin/main
# (ensures all dev work came through the dev branch, not committed directly to main)
DEV_SHA=$(git rev-parse origin/dev)
MERGE_BASE=$(git merge-base origin/main origin/dev)

if [ "$MERGE_BASE" != "$DEV_SHA" ]; then
  echo ""
  echo "  ERROR: origin/dev has commits that are not yet in origin/main."
  echo "  dev:        $DEV_SHA"
  echo "  merge-base: $MERGE_BASE"
  echo ""
  echo "  This means dev is ahead of main. Either:"
  echo "    - Those dev commits are intentionally held back (OK — force deploy with caution)"
  echo "    - You forgot to merge dev into main before deploying"
  echo ""
  echo "  To merge dev into main and deploy:"
  echo "    git checkout main && git merge dev && git push origin main && ./deploy.sh"
  echo ""
  exit 1
fi

echo "[deploy] All checks passed."
echo "[deploy] Branch path: feature/* → dev → main ✓"
echo "[deploy] Deploying commit $(git rev-parse --short HEAD) — $(git log -1 --format='%s')"
echo ""

docker compose up -d --build

echo ""
echo "[deploy] Production container rebuilt and running."
