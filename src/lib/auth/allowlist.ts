/**
 * Login allow-list: AUTH_ALLOWED_EMAILS is a comma-separated env value
 * (effectively a constant for a single-user app — see DATA_MODEL §1).
 * Matching is case-insensitive and whitespace-tolerant.
 */
export function isAllowed(
  email: string,
  allowedEmails: string | undefined,
): boolean {
  if (!allowedEmails) return false
  const normalized = email.trim().toLowerCase()
  if (normalized === '') return false
  return allowedEmails
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .includes(normalized)
}
