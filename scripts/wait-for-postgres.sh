#!/usr/bin/env bash
set -euo pipefail

PG_HOST="${PG_HOST:-localhost}"
PG_PORT="${PG_PORT:-5432}"
PG_USER="${PG_USER:-perplex}"
PG_DB="${PG_DB:-perplex}"
TIMEOUT_SEC="${TIMEOUT_SEC:-60}"

echo "Waiting for postgres at $PG_HOST:$PG_PORT ..."

deadline=$(( $(date +%s) + TIMEOUT_SEC ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  if docker compose exec -T postgres pg_isready -U "$PG_USER" -d "$PG_DB" -h localhost >/dev/null 2>&1; then
    echo "postgres ready."
    exit 0
  fi
  sleep 1
done

echo "postgres did not become ready within ${TIMEOUT_SEC}s" >&2
exit 1
