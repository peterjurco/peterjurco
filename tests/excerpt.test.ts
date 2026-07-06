import { describe, expect, it } from 'vitest'
import { deriveExcerpt } from '../src/lib/articles/excerpt'

function doc(...content: unknown[]): Record<string, unknown> {
  return { type: 'doc', content }
}

function paragraph(text: string, marks?: unknown[]): Record<string, unknown> {
  return {
    type: 'paragraph',
    content: [{ type: 'text', text, ...(marks ? { marks } : {}) }],
  }
}

describe('deriveExcerpt', () => {
  it('returns the first paragraph as plain text', () => {
    const excerpt = deriveExcerpt(doc(paragraph('Hello world.')), 200)
    expect(excerpt).toBe('Hello world.')
  })

  it('strips marks — bold text comes through as plain text', () => {
    const excerpt = deriveExcerpt(
      doc(paragraph('Loud intro', [{ type: 'bold' }])),
      200,
    )
    expect(excerpt).toBe('Loud intro')
  })

  it('joins multiple paragraphs with a space up to the limit', () => {
    const excerpt = deriveExcerpt(
      doc(paragraph('First part.'), paragraph('Second part.')),
      200,
    )
    expect(excerpt).toBe('First part. Second part.')
  })

  it('skips headings — the title is not the description', () => {
    const excerpt = deriveExcerpt(
      doc(
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Section title' }],
        },
        paragraph('Actual body text.'),
      ),
      200,
    )
    expect(excerpt).toBe('Actual body text.')
  })

  it('truncates at a word boundary with an ellipsis', () => {
    const excerpt = deriveExcerpt(
      doc(paragraph('The quick brown fox jumps over the lazy dog')),
      20,
    )
    expect(excerpt.length).toBeLessThanOrEqual(20)
    expect(excerpt.endsWith('…')).toBe(true)
    // Never cuts mid-word: the fragment before the ellipsis is whole words.
    expect('The quick brown fox jumps'.startsWith(excerpt.slice(0, -1))).toBe(
      true,
    )
    expect(excerpt.slice(0, -1).trimEnd()).toBe(excerpt.slice(0, -1))
  })

  it('reads nested text (blockquotes, lists)', () => {
    const excerpt = deriveExcerpt(
      doc({
        type: 'blockquote',
        content: [paragraph('Quoted wisdom.')],
      }),
      200,
    )
    expect(excerpt).toBe('Quoted wisdom.')
  })

  it('returns an empty string for empty or malformed docs', () => {
    expect(deriveExcerpt(doc({ type: 'paragraph' }), 200)).toBe('')
    expect(deriveExcerpt(null, 200)).toBe('')
    expect(deriveExcerpt('not a doc', 200)).toBe('')
    expect(deriveExcerpt({ bogus: true }, 200)).toBe('')
  })
})
