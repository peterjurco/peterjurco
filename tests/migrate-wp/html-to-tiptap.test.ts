import { describe, expect, it } from 'vitest'
import { htmlToTiptap } from '../../scripts/migrate-wp/html-to-tiptap'
import { renderDoc } from '../../src/lib/articles/render-doc'

describe('htmlToTiptap', () => {
  it('converts headings h1-h6 to their matching level', () => {
    const html = [1, 2, 3, 4, 5, 6]
      .map((level) => `<h${level}>Heading ${level}</h${level}>`)
      .join('')
    const doc = htmlToTiptap(html)
    expect(doc.content).toEqual(
      [1, 2, 3, 4, 5, 6].map((level) => ({
        type: 'heading',
        attrs: { level },
        content: [{ type: 'text', text: `Heading ${level}` }],
      })),
    )
  })

  it('converts a plain paragraph', () => {
    const doc = htmlToTiptap('<p>Hello world</p>')
    expect(doc.content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] },
    ])
  })

  it('converts bold, italic and strike marks (and their tag aliases)', () => {
    const doc = htmlToTiptap(
      '<p><strong>bold</strong> <b>bold2</b> <em>italic</em> <i>italic2</i> <s>strike</s> <del>strike2</del></p>',
    )
    expect(doc.content).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' ' },
          { type: 'text', text: 'bold2', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' ' },
          { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
          { type: 'text', text: ' ' },
          { type: 'text', text: 'italic2', marks: [{ type: 'italic' }] },
          { type: 'text', text: ' ' },
          { type: 'text', text: 'strike', marks: [{ type: 'strike' }] },
          { type: 'text', text: ' ' },
          { type: 'text', text: 'strike2', marks: [{ type: 'strike' }] },
        ],
      },
    ])
  })

  it('nests marks when tags are combined', () => {
    const doc = htmlToTiptap('<p><strong><em>both</em></strong></p>')
    expect(doc.content).toEqual([
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'both',
            marks: [{ type: 'bold' }, { type: 'italic' }],
          },
        ],
      },
    ])
  })

  it('preserves link hrefs', () => {
    const doc = htmlToTiptap(
      '<p><a href="https://example.com" target="_blank" rel="nofollow">a link</a></p>',
    )
    expect(doc.content).toEqual([
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'a link',
            marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
          },
        ],
      },
    ])
  })

  it('drops javascript: links but keeps the text', () => {
    const doc = htmlToTiptap('<p><a href="javascript:alert(1)">click</a></p>')
    expect(doc.content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'click' }] },
    ])
  })

  it('converts unordered and ordered lists', () => {
    const doc = htmlToTiptap(
      '<ul><li>one</li><li>two</li></ul><ol><li>first</li><li>second</li></ol>',
    )
    expect(doc.content).toEqual([
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'one' }] },
            ],
          },
          {
            type: 'listItem',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'two' }] },
            ],
          },
        ],
      },
      {
        type: 'orderedList',
        content: [
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'first' }],
              },
            ],
          },
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'second' }],
              },
            ],
          },
        ],
      },
    ])
  })

  it('converts a nested list inside a list item', () => {
    const doc = htmlToTiptap('<ul><li>parent<ul><li>child</li></ul></li></ul>')
    expect(doc.content).toEqual([
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'parent' }],
              },
              {
                type: 'bulletList',
                content: [
                  {
                    type: 'listItem',
                    content: [
                      {
                        type: 'paragraph',
                        content: [{ type: 'text', text: 'child' }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ])
  })

  it('converts blockquotes', () => {
    const doc = htmlToTiptap('<blockquote><p>quoted</p></blockquote>')
    expect(doc.content).toEqual([
      {
        type: 'blockquote',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'quoted' }] },
        ],
      },
    ])
  })

  it('preserves image src without rehosting (a deliberate deferred step)', () => {
    const doc = htmlToTiptap(
      '<p><img src="https://example.com/photo.jpg" alt="a photo"></p>',
    )
    expect(doc.content).toEqual([
      {
        type: 'paragraph',
        content: [
          {
            type: 'image',
            attrs: { src: 'https://example.com/photo.jpg', alt: 'a photo' },
          },
        ],
      },
    ])
  })

  it('drops images with unsafe src', () => {
    const doc = htmlToTiptap('<p><img src="javascript:alert(1)"></p>')
    expect(doc.content).toEqual([{ type: 'paragraph', content: [] }])
  })

  it('converts <br> to a hard break within a paragraph', () => {
    const doc = htmlToTiptap('<p>line one<br>line two</p>')
    expect(doc.content).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'line one' },
          { type: 'hardBreak' },
          { type: 'text', text: 'line two' },
        ],
      },
    ])
  })

  it('degrades unknown/unsupported tags to plain paragraphs instead of crashing', () => {
    const doc = htmlToTiptap(
      '<table><tr><td>cell one</td><td>cell two</td></tr></table>',
    )
    expect(doc.content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'cell one' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'cell two' }] },
    ])
  })

  it('drops script/style tags entirely rather than surfacing their text', () => {
    const doc = htmlToTiptap(
      '<p>before</p><script>alert(1)</script><style>p{color:red}</style><p>after</p>',
    )
    expect(doc.content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'before' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'after' }] },
    ])
  })

  it('flattens container tags like div/section/figure instead of dropping their content', () => {
    const doc = htmlToTiptap('<div><section><p>nested</p></section></div>')
    expect(doc.content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'nested' }] },
    ])
  })

  it('never throws on malformed or empty HTML', () => {
    expect(() => htmlToTiptap('<p>unclosed<div><span>oops')).not.toThrow()
    expect(() => htmlToTiptap('')).not.toThrow()
    expect(() => htmlToTiptap('not even html just text')).not.toThrow()
    // biome-ignore lint/suspicious/noExplicitAny: exercising a hostile/non-string input on purpose
    expect(() => htmlToTiptap(null as any)).not.toThrow()
  })

  it('falls back to an empty paragraph doc for empty/whitespace-only input', () => {
    expect(htmlToTiptap('').content).toEqual([
      { type: 'paragraph', content: [] },
    ])
    expect(htmlToTiptap('   ').content).toEqual([
      { type: 'paragraph', content: [] },
    ])
  })

  it('always returns a well-formed doc node', () => {
    const doc = htmlToTiptap('<p>hi</p>')
    expect(doc.type).toBe('doc')
    expect(Array.isArray(doc.content)).toBe(true)
  })

  describe('round-trip through the real renderer', () => {
    it('renders converted headings, marks, links, lists, blockquotes and images as sane HTML', () => {
      const html =
        '<h2>Title</h2>' +
        '<p>Some <strong>bold</strong> and <em>italic</em> text with a ' +
        '<a href="https://example.com">link</a>.</p>' +
        '<ul><li>one</li><li>two</li></ul>' +
        '<blockquote><p>a quote</p></blockquote>' +
        '<p><img src="https://example.com/photo.jpg" alt="a photo"></p>'

      const doc = htmlToTiptap(html)
      const rendered = renderDoc(doc)

      expect(rendered).toContain('<h2>Title</h2>')
      expect(rendered).toContain('<strong>bold</strong>')
      expect(rendered).toContain('<em>italic</em>')
      expect(rendered).toContain('href="https://example.com"')
      expect(rendered).toContain('<ul>')
      expect(rendered).toContain('<li>')
      expect(rendered).toContain('<blockquote>')
      expect(rendered).toContain('src="https://example.com/photo.jpg"')
    })

    it('never produces a doc that renderDoc rejects (empty string)', () => {
      const doc = htmlToTiptap('<p>hello</p>')
      expect(renderDoc(doc)).not.toBe('')
    })
  })
})
