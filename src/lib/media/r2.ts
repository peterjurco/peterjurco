import { AwsClient } from 'aws4fetch'
import { requireEnv } from '../env'
import { newPublicId } from '../public-id'

/**
 * R2 upload helpers (TECH_DECISIONS §5). Uploads go browser → R2 directly via
 * a short-lived SigV4 query-signed PUT URL (aws4fetch — Workers-native, no
 * Node SDK), so image bytes never pass through the Worker.
 */

/** Content types the presign endpoint will mint URLs for. */
export const ALLOWED_IMAGE_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
] as const

/** Declared-size cap for a single upload (enforced at the presign API). */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024

/** Presigned URLs expire after 10 minutes — enough for one upload. */
export const PRESIGN_EXPIRES_SECONDS = 600

export interface R2Env {
  R2_ACCOUNT_ID?: string
  R2_ACCESS_KEY_ID?: string
  R2_SECRET_ACCESS_KEY?: string
  R2_BUCKET?: string
  /** Test-only S3 endpoint override (MinIO) — unset in production. */
  R2_ENDPOINT?: string
}

/**
 * Opaque, collision-safe object key. The client filename is untrusted input —
 * only a short alphanumeric extension survives (lowercased); everything else
 * is replaced by a fresh public id, so keys can't collide or traverse paths.
 */
export function objectKey(prefix: string, filename: string): string {
  const match = /\.([A-Za-z0-9]{1,5})$/.exec(filename)
  const extension = match ? `.${match[1].toLowerCase()}` : ''
  return `${prefix}/${newPublicId()}${extension}`
}

function endpointFor(env: R2Env): string {
  const endpoint =
    env.R2_ENDPOINT ??
    `https://${requireEnv(env.R2_ACCOUNT_ID, 'R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`
  return endpoint.replace(/\/+$/, '')
}

/**
 * Short-lived presigned PUT URL for `key`, with `contentType` bound into the
 * signature (X-Amz-SignedHeaders) — the holder can only PUT that exact
 * Content-Type. Which types (and declared sizes) are acceptable is decided by
 * the presign API endpoint before a URL is ever minted
 * (src/pages/api/media/presign.ts); actual byte size is not re-verified by
 * storage.
 */
export async function presignPut(
  env: R2Env,
  key: string,
  contentType: string,
): Promise<string> {
  const client = new AwsClient({
    accessKeyId: requireEnv(env.R2_ACCESS_KEY_ID, 'R2_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv(
      env.R2_SECRET_ACCESS_KEY,
      'R2_SECRET_ACCESS_KEY',
    ),
    service: 's3',
    region: 'auto',
  })
  const bucket = requireEnv(env.R2_BUCKET, 'R2_BUCKET')
  const url = new URL(`${endpointFor(env)}/${bucket}/${key}`)
  url.searchParams.set('X-Amz-Expires', String(PRESIGN_EXPIRES_SECONDS))
  // allHeaders: aws4fetch skips content-type by default (UNSIGNABLE_HEADERS);
  // the only header on this request is the Content-Type we want signed.
  const signed = await client.sign(
    new Request(url, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
    }),
    { aws: { signQuery: true, allHeaders: true } },
  )
  return signed.url
}
