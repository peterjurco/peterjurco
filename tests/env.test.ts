import { describe, expect, it } from 'vitest'
import { requireEnv } from '../src/lib/env'

describe('requireEnv', () => {
  it('returns the value when set', () => {
    expect(requireEnv('some-value', 'SOME_VAR')).toBe('some-value')
  })

  it('throws a clear error naming the missing variable', () => {
    expect(() => requireEnv(undefined, 'SESSION_SECRET')).toThrow(
      'Missing required environment variable: SESSION_SECRET',
    )
    expect(() => requireEnv('', 'DATABASE_URL')).toThrow(
      'Missing required environment variable: DATABASE_URL',
    )
  })
})
