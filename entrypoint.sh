#!/bin/sh

# Auto-generate JWT_SECRET if not provided via environment.
# The secret is persisted to the data volume so it survives container restarts.
# To override, set JWT_SECRET in docker-compose.yml environment or a .env file.

SECRET_FILE="/data/.jwt_secret"

if [ -z "$JWT_SECRET" ]; then
  if [ -f "$SECRET_FILE" ]; then
    export JWT_SECRET=$(cat "$SECRET_FILE")
  else
    export JWT_SECRET=$(head -c 48 /dev/urandom | base64)
    mkdir -p /data
    echo "$JWT_SECRET" > "$SECRET_FILE"
    chmod 600 "$SECRET_FILE"
    echo "[entrypoint] Generated new JWT_SECRET and saved to $SECRET_FILE"
  fi
fi

exec "$@"
