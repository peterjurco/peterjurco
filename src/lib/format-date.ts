/** Compact UTC timestamp for listing rows: `YYYY-MM-DD HH:mm`. */
export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 16).replace('T', ' ')
}

const MONTH_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

/** Absolute UTC date for listing rows: `D Mon YYYY`, e.g. `22 Jan 2026`. */
export function formatFullDate(date: Date): string {
  return `${date.getUTCDate()} ${MONTH_ABBR[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}

/**
 * Google-Drive-style relative UTC timestamp: `HH:mm` for today, `D Mon` for
 * the current year, `D Mon YYYY` for earlier years. `now` is injectable for
 * tests; defaults to the real current time.
 */
export function formatRelativeDate(date: Date, now: Date = new Date()): string {
  const isToday =
    date.getUTCFullYear() === now.getUTCFullYear() &&
    date.getUTCMonth() === now.getUTCMonth() &&
    date.getUTCDate() === now.getUTCDate()
  if (isToday) {
    const hours = String(date.getUTCHours()).padStart(2, '0')
    const minutes = String(date.getUTCMinutes()).padStart(2, '0')
    return `${hours}:${minutes}`
  }

  const isThisYear = date.getUTCFullYear() === now.getUTCFullYear()
  if (isThisYear) {
    return `${date.getUTCDate()} ${MONTH_ABBR[date.getUTCMonth()]}`
  }

  return formatFullDate(date)
}
