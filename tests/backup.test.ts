import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Unit tests for the pure shell functions in scripts/backup-db.sh (key
 * naming, prune cutoff date math, prune selection). The script separates
 * these from the networked steps (pg_dump / aws) exactly so they can be
 * exercised deterministically: sourcing the script defines the functions
 * without running main.
 */

const SCRIPT = new URL('../scripts/backup-db.sh', import.meta.url).pathname

/** Runs `snippet` in bash with the backup script's functions sourced. */
function bash(snippet: string, input = ''): string {
  return execFileSync(
    'bash',
    ['-c', `set -euo pipefail; source "$1"; ${snippet}`, 'bash', SCRIPT],
    { input, encoding: 'utf8' },
  )
}

/** Epoch seconds for a UTC calendar date. */
function utcEpoch(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): number {
  return Date.UTC(year, month - 1, day, hour, minute, second) / 1000
}

describe('backup-db.sh — script contract', () => {
  it('fails loudly: set -euo pipefail, and sourcing never runs main', () => {
    const script = readFileSync(SCRIPT, 'utf8')
    expect(script).toContain('set -euo pipefail')
    // Sourcing must not attempt a backup (no env vars are set here) — the
    // `bash` helper would throw if main ran and hit its required-var guards.
    expect(bash('echo sourced-ok').trim()).toBe('sourced-ok')
  })
})

describe('backup_key', () => {
  it('names dumps backups/db/YYYY/peterjurco-<timestamp>.sql.gz', () => {
    expect(bash('backup_key 20260708T031745Z').trim()).toBe(
      'backups/db/2026/peterjurco-20260708T031745Z.sql.gz',
    )
  })

  it('buckets the year folder from the timestamp itself', () => {
    expect(bash('backup_key 20301231T235959Z').trim()).toBe(
      'backups/db/2030/peterjurco-20301231T235959Z.sql.gz',
    )
  })
})

describe('format_utc / prune_cutoff', () => {
  it('formats an epoch as a sortable UTC timestamp', () => {
    const epoch = utcEpoch(2026, 7, 8, 3, 17, 45)
    expect(bash(`format_utc ${epoch}`).trim()).toBe('20260708T031745Z')
  })

  it('computes the retention horizon N days before now', () => {
    const now = utcEpoch(2026, 7, 8, 3, 17, 0)
    expect(bash(`prune_cutoff 30 ${now}`).trim()).toBe('20260608T031700Z')
  })

  it('crosses month and year boundaries correctly', () => {
    const now = utcEpoch(2026, 1, 5)
    expect(bash(`prune_cutoff 10 ${now}`).trim()).toBe('20251226T000000Z')
  })
})

describe('keys_to_prune', () => {
  const cutoff = '20260608T031700Z'

  it('selects only backup keys strictly older than the cutoff', () => {
    const keys = [
      'backups/db/2026/peterjurco-20260501T031700Z.sql.gz', // older — prune
      'backups/db/2026/peterjurco-20260608T031659Z.sql.gz', // 1s older — prune
      'backups/db/2026/peterjurco-20260608T031700Z.sql.gz', // at cutoff — keep
      'backups/db/2026/peterjurco-20260708T031700Z.sql.gz', // newer — keep
    ].join('\n')
    const pruned = bash(`keys_to_prune ${cutoff}`, `${keys}\n`)
      .trim()
      .split('\n')
    expect(pruned).toEqual([
      'backups/db/2026/peterjurco-20260501T031700Z.sql.gz',
      'backups/db/2026/peterjurco-20260608T031659Z.sql.gz',
    ])
  })

  it('spans year folders — old years are pruned too', () => {
    const keys = 'backups/db/2025/peterjurco-20251231T235959Z.sql.gz\n'
    expect(bash(`keys_to_prune ${cutoff}`, keys).trim()).toBe(
      'backups/db/2025/peterjurco-20251231T235959Z.sql.gz',
    )
  })

  it('never selects keys outside the backup naming scheme', () => {
    const keys = [
      'covers/xyz.jpg',
      'backups/db/2026/manual-snapshot.sql.gz',
      'backups/db/2026/peterjurco-not-a-timestamp.sql.gz',
      'backups/db/2026/peterjurco-20260101T000000Z.sql', // missing .gz
      'None', // aws cli --output text for an empty bucket
      '',
    ].join('\n')
    expect(bash(`keys_to_prune ${cutoff}`, `${keys}\n`).trim()).toBe('')
  })
})
