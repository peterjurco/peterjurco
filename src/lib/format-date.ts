/** Compact UTC timestamp for listing rows: `YYYY-MM-DD HH:mm`. */
export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 16).replace('T', ' ')
}
