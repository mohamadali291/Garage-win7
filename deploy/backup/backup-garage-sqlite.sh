#!/usr/bin/env bash
set -euo pipefail

# Simple SQLite backup helper.
# Recommended: run daily via cron or a systemd timer.
#
# Example:
#   sudo mkdir -p /var/backups/garage
#   sudo bash deploy/backup/backup-garage-sqlite.sh /var/lib/garage/garage.sqlite /var/backups/garage

DB_PATH="${1:-/var/lib/garage/garage.sqlite}"
BACKUP_DIR="${2:-/var/backups/garage}"

if [[ ! -f "$DB_PATH" ]]; then
  echo "DB file not found: $DB_PATH" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

ts="$(date -u +%Y%m%dT%H%M%SZ)"
out="$BACKUP_DIR/garage.sqlite.$ts"

# If sqlite3 CLI is available, use a consistent backup.
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB_PATH" ".backup '$out'"
else
  # Fallback: copy the file (WAL mode is enabled; this is still usually fine,
  # but sqlite3 .backup is preferred).
  cp -f "$DB_PATH" "$out"
fi

echo "Wrote backup: $out"

