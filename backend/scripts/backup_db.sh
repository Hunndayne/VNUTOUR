#!/usr/bin/env bash
# Dump PostgreSQL to ./backups, then prune old dumps.
#
# The homelab owns this data outright, so there is no provider snapshot to fall
# back on. The deploy workflow runs this before migrations, and cron should run
# it nightly.
set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE="${BACKEND_ENV_FILE:-.env.docker}"
BACKUP_DIR="${BACKUP_DIR:-backups}"
RETENTION="${BACKUP_RETENTION:-14}"
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml:docker-compose.prod.yml}"

compose() {
  docker compose --env-file "$ENV_FILE" "$@"
}

# The first deploy has no database yet; that is not a failure.
if [ -z "$(compose ps --status running --quiet postgres 2>/dev/null)" ]; then
  echo "postgres is not running; skipping backup"
  exit 0
fi

mkdir -p "$BACKUP_DIR"
out="$BACKUP_DIR/vnutour-$(date -u +%Y%m%dT%H%M%SZ).dump"

# Credentials stay inside the container, so nothing has to be parsed out of the
# env file here.
compose exec -T postgres sh -c \
  'pg_dump --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --format=custom' > "$out"

# A truncated dump is worse than an obvious failure, because it looks like a
# backup until the day someone restores it.
if [ ! -s "$out" ]; then
  rm -f "$out"
  echo "pg_dump produced an empty file" >&2
  exit 1
fi

echo "wrote $out ($(du -h "$out" | cut -f1))"

ls -1t "$BACKUP_DIR"/vnutour-*.dump 2>/dev/null \
  | tail -n "+$((RETENTION + 1))" \
  | xargs -r rm --
