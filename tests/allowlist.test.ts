import { describe, expect, it } from 'vitest'
import { isAllowed } from '../src/lib/auth/allowlist'

describe('isAllowed', () => {
  it('allows an email present in the comma-separated list', () => {
    expect(isAllowed('me@example.com', 'me@example.com')).toBe(true)
    expect(
      isAllowed('second@example.com', 'me@example.com,second@example.com'),
    ).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isAllowed('Me@Example.COM', 'me@example.com')).toBe(true)
    expect(isAllowed('me@example.com', 'ME@EXAMPLE.COM')).toBe(true)
  })

  it('tolerates whitespace around list entries', () => {
    expect(isAllowed('b@example.com', 'a@example.com , b@example.com ')).toBe(
      true,
    )
  })

  it('denies an email not in the list', () => {
    expect(isAllowed('intruder@example.com', 'me@example.com')).toBe(false)
  })

  it('denies partial matches', () => {
    expect(isAllowed('me@example.co', 'me@example.com')).toBe(false)
    expect(isAllowed('me@example.com', 'some-me@example.com')).toBe(false)
  })

  it('denies everything when the allow-list is missing or empty', () => {
    expect(isAllowed('me@example.com', undefined)).toBe(false)
    expect(isAllowed('me@example.com', '')).toBe(false)
    expect(isAllowed('', 'me@example.com')).toBe(false)
    expect(isAllowed('', '')).toBe(false)
  })
})
