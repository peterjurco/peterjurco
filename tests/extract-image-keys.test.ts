import { describe, expect, it } from 'vitest'
import { extractImageKeys } from '../src/lib/articles/extract-image-keys'

/** Matches this repo's real dev/test config shape (see media.image-url.test.ts). */
const config = { baseUrl: 'https://media.peterjur.co', transforms: false }

function imageNode(src: string) {
  return { type: 'image', attrs: { src } }
}

describe('extractImageKeys', () => {
  it('finds a single top-level image', () => {
    const doc = {
      type: 'doc',
      content: [imageNode('https://media.peterjur.co/articles/one.png')],
    }
    expect(extractImageKeys(doc, config)).toEqual(['articles/one.png'])
  })

  it('finds images nested inside other block content', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'hello' }],
        },
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  content: [
                    imageNode('https://media.peterjur.co/articles/nested.png'),
                  ],
                },
              ],
            },
          ],
        },
      ],
    }
    expect(extractImageKeys(doc, config)).toEqual(['articles/nested.png'])
  })

  it('collects multiple images in document order', () => {
    const doc = {
      type: 'doc',
      content: [
        imageNode('https://media.peterjur.co/articles/a.png'),
        { type: 'paragraph' },
        imageNode('https://media.peterjur.co/articles/b.png'),
      ],
    }
    expect(extractImageKeys(doc, config)).toEqual([
      'articles/a.png',
      'articles/b.png',
    ])
  })

  it('skips a hand-typed external URL (toolbar "Insert Image" prompt)', () => {
    const doc = {
      type: 'doc',
      content: [imageNode('https://example.com/some-photo.jpg')],
    }
    expect(extractImageKeys(doc, config)).toEqual([])
  })

  it('ignores non-image nodes entirely', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'no images here' }],
        },
      ],
    }
    expect(extractImageKeys(doc, config)).toEqual([])
  })

  it('returns an empty array for malformed or missing content, never throws', () => {
    expect(extractImageKeys(null)).toEqual([])
    expect(extractImageKeys(undefined)).toEqual([])
    expect(extractImageKeys('not a doc')).toEqual([])
    expect(extractImageKeys({})).toEqual([])
  })
})
