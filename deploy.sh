#!/usr/bin/env bash
# Compatibility wrapper — prefer scripts/deploy.sh
exec "$(dirname "$0")/scripts/deploy.sh" "$@"
