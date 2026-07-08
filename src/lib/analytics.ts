/**
 * Cloudflare Web Analytics (TECH_DECISIONS §7 — deliberately NOT Google
 * Analytics: "Google gets no access"). Free, privacy-friendly and
 * cookie-less, so no consent banner is needed.
 */

export const BEACON_SRC = 'https://static.cloudflareinsights.com/beacon.min.js'

export interface BeaconAttrs {
  src: string
  /** JSON payload for the `data-cf-beacon` attribute. */
  dataCfBeacon: string
}

/**
 * Attributes for the beacon `<script>`, or null when it must not render:
 * outside production builds (dev/tests stay beacon-free) or without a
 * configured `PUBLIC_CF_ANALYTICS_TOKEN`.
 */
export function beaconAttrs(
  token: string | undefined,
  isProd: boolean,
): BeaconAttrs | null {
  if (!isProd) return null
  const trimmed = token?.trim()
  if (!trimmed) return null
  return { src: BEACON_SRC, dataCfBeacon: JSON.stringify({ token: trimmed }) }
}
