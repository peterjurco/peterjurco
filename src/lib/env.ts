/**
 * Returns the env value or throws a clear error naming the missing variable —
 * used at the point of use so misconfiguration fails loudly and legibly
 * instead of surfacing as an opaque undefined somewhere downstream.
 */
export function requireEnv(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}
