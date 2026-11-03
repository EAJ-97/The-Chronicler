#!/usr/bin/env bash
# notesapp: prefer volume-aware archive; fall back to ./data if present.
set -euo pipefail

cd "$(dirname "$0")/.."
PROJECT="$(basename "$PWD")"
DEST="$HOME/backups/$PROJECT"
KEEP="${KEEP:-10}"
VOLUME_NAME="${CHRONICLER_VOLUME:-notesapp_chronicler_data}"

mkdir -p "$DEST"
NAME="$PROJECT-$(date +%Y%m%d-%H%M%S).tar.gz"

if docker volume inspect "$VOLUME_NAME" >/dev/null 2>&1; then
  docker run --rm \
    -v "$VOLUME_NAME":/data:ro \
    -v "$DEST":/backup \
    alpine:3.20 \
    sh -c "tar czf /backup/$NAME -C / data && chown $(id -u):$(id -g) /backup/$NAME"
  echo "Backup: $DEST/$NAME ($(du -h "$DEST/$NAME" | cut -f1)) [volume $VOLUME_NAME]"
else
  [[ -d data ]] || { echo "No data/ and no volume $VOLUME_NAME; nothing to back up."; exit 0; }
  if ! tar czf "$DEST/$NAME" data/ 2>/dev/null; then
    rm -f "$DEST/$NAME"
    docker run --rm -v "$PWD/data:/data:ro" -v "$DEST:/backup" alpine:3.20 \
      sh -c "tar czf /backup/$NAME -C / data && chown $(id -u):$(id -g) /backup/$NAME"
  fi
  echo "Backup: $DEST/$NAME ($(du -h "$DEST/$NAME" | cut -f1))"
fi

ls -1t "$DEST"/"$PROJECT"-*.tar.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm --
