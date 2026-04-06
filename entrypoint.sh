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

# Auto-generate ADMIN_RECOVERY_TOKEN if not provided via environment.
# Persisted to the data volume so operators can read it from the host (docker exec cat /data/.admin_recovery_token).
# Override by setting ADMIN_RECOVERY_TOKEN in docker-compose environment or .env.

RECOVERY_FILE="/data/.admin_recovery_token"

if [ -z "$ADMIN_RECOVERY_TOKEN" ]; then
  if [ -f "$RECOVERY_FILE" ]; then
    export ADMIN_RECOVERY_TOKEN=$(tr -d '\n\r' < "$RECOVERY_FILE")
  else
    if command -v openssl >/dev/null 2>&1; then
      export ADMIN_RECOVERY_TOKEN=$(openssl rand -hex 32)
    else
      export ADMIN_RECOVERY_TOKEN=$(head -c 48 /dev/urandom | base64 | tr -d '\n')
    fi
    mkdir -p /data
    printf '%s' "$ADMIN_RECOVERY_TOKEN" > "$RECOVERY_FILE"
    chmod 600 "$RECOVERY_FILE"
    echo "[entrypoint] Generated ADMIN_RECOVERY_TOKEN and saved to $RECOVERY_FILE"
  fi
fi

exec "$@"
