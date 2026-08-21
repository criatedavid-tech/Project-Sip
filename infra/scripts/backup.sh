#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
backup_root="${BACKUP_ROOT:-/var/backups/project-sip}"
retention_days="${BACKUP_RETENTION_DAYS:-14}"
recordings_dir="$repo_root/infra/.local/asterisk-recordings"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
destination="$backup_root/$timestamp"
temporary=""

if [[ ! "$retention_days" =~ ^[0-9]+$ ]]; then
  echo "BACKUP_RETENTION_DAYS deve ser um inteiro positivo" >&2
  exit 1
fi

if [[ "$(id -u)" -eq 0 ]]; then
  docker_command=(docker)
else
  docker_command=(sudo -n docker)
fi

cleanup() {
  if [[ -n "$temporary" && -d "$temporary" ]]; then
    rm -rf -- "$temporary"
  fi
}
trap cleanup EXIT

mkdir -p -- "$backup_root"
chmod 700 "$backup_root"
temporary="$(mktemp -d "$backup_root/.tmp-$timestamp-XXXXXX")"

compose=(
  "${docker_command[@]}" compose
  --env-file "$repo_root/.env"
  -f "$repo_root/infra/docker-compose.yml"
)

"${compose[@]}" exec -T postgres sh -lc \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' \
  > "$temporary/postgres.dump"

if [[ -d "$recordings_dir" ]]; then
  tar -C "$recordings_dir" -czf "$temporary/asterisk-recordings.tar.gz" .
else
  tar -czf "$temporary/asterisk-recordings.tar.gz" --files-from /dev/null
fi

(
  cd "$temporary"
  sha256sum postgres.dump asterisk-recordings.tar.gz > SHA256SUMS
)

chmod 600 "$temporary"/*
mv -- "$temporary" "$destination"
temporary=""

find "$backup_root" -mindepth 1 -maxdepth 1 -type d \
  -name '20????????T??????Z' -mtime "+$retention_days" -exec rm -rf -- {} +

echo "Backup concluido em $destination"
