#!/usr/bin/env bash
#
# Nightly Neon → R2 database backup (TECH_DECISIONS §4).
#
# `pg_dump` is a native binary and cannot run on the Workers runtime, so
# backups run in a scheduled GitHub Action (.github/workflows/backup.yml):
# dump → gzip → upload to R2 over its S3 API, then prune dumps older than
# RETENTION_DAYS. Complements Neon's built-in point-in-time restore.
#
# Required env:
#   DATABASE_URL                  Neon connection string
#   R2_BACKUP_ENDPOINT_URL        https://<account-id>.r2.cloudflarestorage.com
#   R2_BACKUP_BUCKET              destination bucket
#   R2_BACKUP_ACCESS_KEY_ID       R2 S3-API credentials
#   R2_BACKUP_SECRET_ACCESS_KEY
# Optional:
#   RETENTION_DAYS                prune horizon (default 30)
#   PG_DUMP_BIN                   exact pg_dump binary to invoke (default:
#                                 whatever `pg_dump` resolves to on PATH).
#                                 On Debian/Ubuntu, installing a PGDG version
#                                 (postgresql-client-18) does NOT repoint the
#                                 plain `pg_dump` on PATH — it stays whatever
#                                 the distro's own package provided. Set this
#                                 to the versioned binary
#                                 (/usr/lib/postgresql/<N>/bin/pg_dump) to
#                                 guarantee the right one runs.
#
# Every step fails loudly (set -euo pipefail) so a broken backup turns the
# workflow run red instead of silently uploading nothing.
#
# The date/key helpers below are pure functions — tests/backup.test.ts
# sources this file (which defines them without running main) and calls them
# directly.

set -euo pipefail

# --- pure helpers (unit-tested) ---------------------------------------------

# backup_key TIMESTAMP → backups/db/YYYY/peterjurco-TIMESTAMP.sql.gz
backup_key() {
  local ts="$1"
  printf 'backups/db/%s/peterjurco-%s.sql.gz\n' "${ts:0:4}" "$ts"
}

# format_utc EPOCH_SECONDS → 20260708T031745Z (sortable; lexicographic order
# is chronological order, which keys_to_prune relies on). GNU date first
# (GitHub runners), BSD date fallback (macOS dev machines).
format_utc() {
  date -u -d "@$1" +%Y%m%dT%H%M%SZ 2>/dev/null ||
    date -u -r "$1" +%Y%m%dT%H%M%SZ
}

# prune_cutoff RETENTION_DAYS NOW_EPOCH → timestamp of the retention horizon.
prune_cutoff() {
  local days="$1" now="$2"
  format_utc "$((now - days * 86400))"
}

# keys_to_prune CUTOFF_TS — reads object keys (one per line) on stdin and
# prints those whose embedded timestamp sorts strictly before the cutoff.
# Keys outside the backup naming scheme are never selected — the prune step
# must not be able to delete anything this script didn't create.
keys_to_prune() {
  local cutoff="$1" key ts
  while IFS= read -r key; do
    [[ "$key" =~ ^backups/db/[0-9]{4}/peterjurco-([0-9]{8}T[0-9]{6}Z)\.sql\.gz$ ]] ||
      continue
    ts="${BASH_REMATCH[1]}"
    if [[ "$ts" < "$cutoff" ]]; then
      printf '%s\n' "$key"
    fi
  done
}

# --- networked steps ----------------------------------------------------------

r2() {
  aws s3api "$@" --endpoint-url "$R2_BACKUP_ENDPOINT_URL"
}

main() {
  : "${DATABASE_URL:?DATABASE_URL is required}"
  : "${R2_BACKUP_ENDPOINT_URL:?R2_BACKUP_ENDPOINT_URL is required}"
  : "${R2_BACKUP_BUCKET:?R2_BACKUP_BUCKET is required}"
  : "${R2_BACKUP_ACCESS_KEY_ID:?R2_BACKUP_ACCESS_KEY_ID is required}"
  : "${R2_BACKUP_SECRET_ACCESS_KEY:?R2_BACKUP_SECRET_ACCESS_KEY is required}"
  local retention_days="${RETENTION_DAYS:-30}"

  export AWS_ACCESS_KEY_ID="$R2_BACKUP_ACCESS_KEY_ID"
  export AWS_SECRET_ACCESS_KEY="$R2_BACKUP_SECRET_ACCESS_KEY"
  export AWS_DEFAULT_REGION="auto"

  local now ts key dump
  now="$(date -u +%s)"
  ts="$(format_utc "$now")"
  key="$(backup_key "$ts")"
  dump="$(mktemp)"
  # Expand the path into the trap NOW: the trap fires at top-level script
  # exit, where main's local $dump is already gone — deferring the expansion
  # would abort the trap under set -u and turn a successful backup into a
  # red workflow run. mktemp paths never contain quotes.
  # shellcheck disable=SC2064
  trap "rm -f '$dump'" EXIT

  echo "==> pg_dump | gzip"
  "${PG_DUMP_BIN:-pg_dump}" "$DATABASE_URL" | gzip >"$dump"
  # pipefail already catches pg_dump failures; this catches a "successful"
  # but empty dump, which would silently overwrite nothing useful into R2.
  [[ -s "$dump" ]] || {
    echo "ERROR: dump is empty" >&2
    exit 1
  }
  echo "    $(wc -c <"$dump" | tr -d ' ') bytes compressed"

  echo "==> upload s3://${R2_BACKUP_BUCKET}/${key}"
  r2 put-object \
    --bucket "$R2_BACKUP_BUCKET" \
    --key "$key" \
    --body "$dump" \
    --content-type application/gzip >/dev/null

  echo "==> prune dumps older than ${retention_days} days"
  local cutoff old
  cutoff="$(prune_cutoff "$retention_days" "$now")"
  # Daily dumps + a ~30-day horizon stay far below the 1000-key page limit.
  r2 list-objects-v2 \
    --bucket "$R2_BACKUP_BUCKET" \
    --prefix backups/db/ \
    --query 'Contents[].Key' \
    --output text |
    tr '\t' '\n' |
    keys_to_prune "$cutoff" |
    while IFS= read -r old; do
      echo "    deleting ${old}"
      r2 delete-object --bucket "$R2_BACKUP_BUCKET" --key "$old" >/dev/null
    done

  echo "==> done: ${key}"
}

# Sourcing the script (tests) only defines the functions; executing runs main.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
