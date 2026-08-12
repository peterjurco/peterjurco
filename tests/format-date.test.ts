import { describe, expect, it } from 'vitest'
import {
  formatDate,
  formatFullDate,
  formatRelativeDate,
} from '../src/lib/format-date'

describe('formatDate', () => {
  it('formats as compact UTC YYYY-MM-DD HH:mm', () => {
    expect(formatDate(new Date('2026-01-22T12:22:00Z'))).toBe(
      '2026-01-22 12:22',
    )
  })
})

describe('formatFullDate', () => {
  it('formats as D Mon YYYY in UTC', () => {
    expect(formatFullDate(new Date('2026-01-22T12:22:00Z'))).toBe('22 Jan 2026')
    expect(formatFullDate(new Date('2023-09-13T00:00:00Z'))).toBe('13 Sep 2023')
  })
})

describe('formatRelativeDate', () => {
  const now = new Date('2026-08-12T18:00:00Z')

  it('formats as HH:mm when the date is today (UTC)', () => {
    expect(formatRelativeDate(new Date('2026-08-12T12:22:00Z'), now)).toBe(
      '12:22',
    )
  })

  it('formats as D Mon when the date is this year but not today', () => {
    expect(formatRelativeDate(new Date('2026-08-11T09:05:00Z'), now)).toBe(
      '11 Aug',
    )
  })

  it('formats as D Mon YYYY when the date is a previous year', () => {
    expect(formatRelativeDate(new Date('2023-09-13T00:00:00Z'), now)).toBe(
      '13 Sep 2023',
    )
  })

  it('treats the boundary at UTC midnight, not local time', () => {
    // One millisecond into "today" per UTC — must still count as today.
    const justAfterMidnight = new Date('2026-08-12T00:00:00.001Z')
    expect(formatRelativeDate(justAfterMidnight, now)).toBe('00:00')
    // One millisecond before "today" per UTC — must not count as today.
    const justBeforeMidnight = new Date('2026-08-11T23:59:59.999Z')
    expect(formatRelativeDate(justBeforeMidnight, now)).toBe('11 Aug')
  })

  it('defaults `now` to the real current time when omitted', () => {
    // Just asserts it doesn't throw and returns a non-empty string; the
    // branching logic itself is covered by the explicit-`now` cases above.
    expect(formatRelativeDate(new Date()).length).toBeGreaterThan(0)
  })
})
