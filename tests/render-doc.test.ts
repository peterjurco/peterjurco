import { describe, expect, it } from 'vitest'
import { renderDoc } from '../src/lib/articles/render-doc'

function doc(...content: unknown[]): Record<string, unknown> {
  return { type: 'doc', content }
}

function text(value: string, marks?: unknown[]): Record<string, unknown> {
  return { type: 'text', text: value, ...(marks ? { marks } : {}) }
}

function paragraph(...content: unknown[]): Record<string, unknown> {
  return { type: 'paragraph', content }
}

describe('renderDoc — faithful rendering', () => {
  it('renders headings', () => {
    const html = renderDoc(
      doc({
        type: 'heading',
        attrs: { level: 2 },
        content: [text('Section')],
      }),
    )
    expect(html).toContain('<h2>Section</h2>')
  })

  it('renders bold / italic / strike marks', () => {
    const html = renderDoc(
      doc(
        paragraph(
          text('bold', [{ type: 'bold' }]),
          text('italic', [{ type: 'italic' }]),
          text('gone', [{ type: 'strike' }]),
        ),
      ),
    )
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<em>italic</em>')
    expect(html).toContain('<s>gone</s>')
  })

  it('renders text color and font family via textStyle spans', () => {
    const html = renderDoc(
      doc(
        paragraph(
          text('tinted', [
            {
              type: 'textStyle',
              attrs: { color: '#ff0000', fontFamily: 'Georgia' },
            },
          ]),
        ),
      ),
    )
    expect(html).toContain('color: #ff0000')
    expect(html).toContain('font-family: Georgia')
    expect(html).toContain('tinted')
  })

  it('renders links with safe rel and target', () => {
    const html = renderDoc(
      doc(
        paragraph(
          text('click me', [
            { type: 'link', attrs: { href: 'https://example.com/page' } },
          ]),
        ),
      ),
    )
    expect(html).toContain('href="https://example.com/page"')
    expect(html).toMatch(/rel="[^"]*noopener[^"]*noreferrer[^"]*"/)
    expect(html).toContain('target="_blank"')
  })

  it('renders bullet and ordered lists', () => {
    const html = renderDoc(
      doc(
        {
          type: 'bulletList',
          content: [{ type: 'listItem', content: [paragraph(text('one'))] }],
        },
        {
          type: 'orderedList',
          attrs: { start: 3 },
          content: [{ type: 'listItem', content: [paragraph(text('three'))] }],
        },
      ),
    )
    expect(html).toContain('<ul>')
    expect(html).toContain('<li><p>one</p></li>')
    expect(html).toContain('start="3"')
    expect(html).toContain('<li><p>three</p></li>')
  })

  it('renders blockquotes', () => {
    const html = renderDoc(
      doc({ type: 'blockquote', content: [paragraph(text('wisdom'))] }),
    )
    expect(html).toContain('<blockquote><p>wisdom</p></blockquote>')
  })

  it('renders images with the stored src', () => {
    const html = renderDoc(
      doc({
        type: 'image',
        attrs: { src: 'https://cdn.example.com/photo.jpg', alt: 'A photo' },
      }),
    )
    expect(html).toContain('<img')
    expect(html).toContain('src="https://cdn.example.com/photo.jpg"')
    expect(html).toContain('alt="A photo"')
  })

  it('renders an empty doc to an empty paragraph', () => {
    const html = renderDoc(doc({ type: 'paragraph' }))
    expect(html).toBe('<p></p>')
  })
})

describe('renderDoc — XSS safety', () => {
  it('escapes HTML in text nodes', () => {
    const html = renderDoc(doc(paragraph(text('<script>alert(1)</script>'))))
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('escapes attribute-breaking quotes in text nodes', () => {
    const html = renderDoc(
      doc(paragraph(text('"><img src=x onerror=alert(1)>'))),
    )
    expect(html).not.toContain('<img')
    expect(html).not.toContain('onerror=alert(1)>')
  })

  it('drops javascript: link hrefs', () => {
    const html = renderDoc(
      doc(
        paragraph(
          text('bait', [
            { type: 'link', attrs: { href: 'javascript:alert(1)' } },
          ]),
        ),
      ),
    )
    expect(html).not.toContain('javascript:')
    expect(html).toContain('bait')
  })

  it('drops images with unsafe src', () => {
    const html = renderDoc(
      doc({ type: 'image', attrs: { src: 'javascript:alert(1)' } }),
    )
    expect(html).not.toContain('<img')
    expect(html).not.toContain('javascript:')
  })

  it('drops link hrefs that smuggle a scheme past whitespace/control chars', () => {
    for (const href of [
      'java\nscript:alert(1)',
      'java\tscript:alert(1)',
      '\u0001javascript:alert(1)',
      ' javascript:alert(1)',
    ]) {
      const html = renderDoc(
        doc(paragraph(text('bait', [{ type: 'link', attrs: { href } }]))),
      )
      expect(html, JSON.stringify(href)).not.toContain('<a')
      expect(html, JSON.stringify(href)).not.toContain('script:alert')
      expect(html).toContain('bait')
    }
  })

  it('drops image srcs that smuggle a scheme past whitespace/control chars', () => {
    for (const src of [
      'java\nscript:alert(1)',
      'java\u0000script:alert(1)',
      '\tvbscript:msgbox(1)',
    ]) {
      const html = renderDoc(doc({ type: 'image', attrs: { src } }))
      expect(html, JSON.stringify(src)).not.toContain('<img')
    }
  })

  it('drops unknown node types instead of rendering them', () => {
    const html = renderDoc(
      doc(
        { type: 'iframe', attrs: { src: 'https://evil.example.com' } },
        paragraph(text('survives')),
      ),
    )
    expect(html).not.toContain('iframe')
    expect(html).not.toContain('evil.example.com')
    expect(html).toContain('survives')
  })

  it('drops unknown marks', () => {
    const html = renderDoc(
      doc(paragraph(text('plain', [{ type: 'annotation', attrs: {} }]))),
    )
    expect(html).toContain('plain')
    expect(html).not.toContain('annotation')
  })

  it('rejects style-injection in color / font family values', () => {
    const html = renderDoc(
      doc(
        paragraph(
          text('styled', [
            {
              type: 'textStyle',
              attrs: {
                color: 'red;background:url(https://evil.example.com)',
                fontFamily: '"><script>alert(1)</script>',
              },
            },
          ]),
        ),
      ),
    )
    expect(html).not.toContain('evil.example.com')
    expect(html).not.toContain('<script>')
    expect(html).toContain('styled')
  })

  it('returns an empty string for malformed input', () => {
    expect(renderDoc(null)).toBe('')
    expect(renderDoc('nonsense')).toBe('')
    expect(renderDoc({ type: 'not-a-doc' })).toBe('')
  })
})
