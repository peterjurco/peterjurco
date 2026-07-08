import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AwsClient } from 'aws4fetch'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Runs the REAL scripts/backup-db.sh main() end-to-end against MinIO
 * (docker-compose.test.yml, standing in for R2 via R2_BACKUP_ENDPOINT_URL) —
 * the networked steps (pg_dump | gzip → upload → list → prune) that
 * tests/backup.test.ts's pure-function unit tests don't exercise.
 *
 * `pg_dump` itself isn't under test (that's Postgres's contract, not ours):
 * a stub script on PATH stands in, so this runs without a matching-version
 * client installed. What IS under test is the script's own logic: does it
 * actually invoke pg_dump correctly, gzip the output, land it at the right
 * key, and prune old keys via real `aws s3api` calls against a real S3 API.
 */

const SCRIPT = new URL('../scripts/backup-db.sh', import.meta.url).pathname
const MINIO_ENDPOINT = 'http://localhost:9000'
const BUCKET = 'peterjurco-backup-test'
const minio = new AwsClient({
  accessKeyId: 'minioadmin',
  secretAccessKey: 'minioadmin',
  service: 's3',
  region: 'auto',
})

function listKeys(): Promise<string[]> {
  return minio
    .fetch(
      `${MINIO_ENDPOINT}/${BUCKET}?list-type=2&prefix=${encodeURIComponent('backups/db/')}`,
    )
    .then((response) => response.text())
    .then((xml) =>
      [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1] as string),
    )
}

async function deleteKey(key: string): Promise<void> {
  await minio.fetch(`${MINIO_ENDPOINT}/${BUCKET}/${key}`, { method: 'DELETE' })
}

/** A `pg_dump` stub on PATH: ignores its args, writes fixed SQL to stdout. */
function makeStubBinDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'backup-e2e-bin-'))
  const stub = join(dir, 'pg_dump')
  writeFileSync(
    stub,
    '#!/usr/bin/env bash\necho "-- stub dump for $1"\necho "SELECT 1;"\n',
  )
  chmodSync(stub, 0o755)
  return dir
}

function runBackup(env: Record<string, string>): void {
  execFileSync('bash', [SCRIPT], {
    env: {
      ...process.env,
      PATH: `${env.STUB_BIN}:${process.env.PATH}`,
      ...env,
    },
    stdio: 'pipe',
  })
}

beforeAll(async () => {
  const bucket = await minio.fetch(`${MINIO_ENDPOINT}/${BUCKET}`, {
    method: 'PUT',
  })
  if (!bucket.ok && bucket.status !== 409) {
    throw new Error(
      `MinIO bucket create failed (${bucket.status}) — is MinIO up? ` +
        'docker compose -f docker-compose.test.yml up -d',
    )
  }
})

afterAll(async () => {
  for (const key of await listKeys()) await deleteKey(key)
})

describe('backup-db.sh — full script against a real S3 API', () => {
  it('dumps, gzips, uploads under the dated key, and prunes only stale ones', async () => {
    const stubBin = makeStubBinDir()

    // Seed one already-stale object (naming scheme matched, far in the
    // past) and one unrelated key the prune step must never touch.
    await minio.fetch(
      `${MINIO_ENDPOINT}/${BUCKET}/backups/db/2020/peterjurco-20200101T000000Z.sql.gz`,
      { method: 'PUT', body: 'stale' },
    )
    await minio.fetch(`${MINIO_ENDPOINT}/${BUCKET}/covers/unrelated.jpg`, {
      method: 'PUT',
      body: 'not a backup',
    })

    runBackup({
      DATABASE_URL: 'postgres://unused/unused',
      R2_BACKUP_ENDPOINT_URL: MINIO_ENDPOINT,
      R2_BACKUP_BUCKET: BUCKET,
      R2_BACKUP_ACCESS_KEY_ID: 'minioadmin',
      R2_BACKUP_SECRET_ACCESS_KEY: 'minioadmin',
      RETENTION_DAYS: '30',
      STUB_BIN: stubBin,
    })

    const keys = await listKeys()
    const fresh = keys.filter((key) =>
      /^backups\/db\/\d{4}\/peterjurco-\d{8}T\d{6}Z\.sql\.gz$/.test(key),
    )
    expect(fresh).toHaveLength(1)
    expect(
      keys.includes('backups/db/2020/peterjurco-20200101T000000Z.sql.gz'),
    ).toBe(false) // pruned

    // The unrelated key survives — the prune step's naming-scheme guard
    // (tested in isolation in tests/backup.test.ts) holds for real deletes.
    const covers = await minio.fetch(
      `${MINIO_ENDPOINT}/${BUCKET}/covers/unrelated.jpg`,
    )
    expect(covers.status).toBe(200)

    // The uploaded object is really the gzipped stub dump, not an empty file.
    const uploaded = await minio.fetch(
      `${MINIO_ENDPOINT}/${BUCKET}/${fresh[0]}`,
    )
    expect(uploaded.headers.get('content-type')).toBe('application/gzip')
    const bytes = new Uint8Array(await uploaded.arrayBuffer())
    expect(bytes.length).toBeGreaterThan(0)
    expect(bytes[0]).toBe(0x1f) // gzip magic byte
    expect(bytes[1]).toBe(0x8b)
  })

  it('fails loudly when pg_dump exits non-zero (set -euo pipefail)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'backup-e2e-fail-'))
    const stub = join(dir, 'pg_dump')
    writeFileSync(stub, '#!/usr/bin/env bash\nexit 1\n')
    chmodSync(stub, 0o755)

    expect(() =>
      runBackup({
        DATABASE_URL: 'postgres://unused/unused',
        R2_BACKUP_ENDPOINT_URL: MINIO_ENDPOINT,
        R2_BACKUP_BUCKET: BUCKET,
        R2_BACKUP_ACCESS_KEY_ID: 'minioadmin',
        R2_BACKUP_SECRET_ACCESS_KEY: 'minioadmin',
        STUB_BIN: dir,
      }),
    ).toThrow()
  })
})
