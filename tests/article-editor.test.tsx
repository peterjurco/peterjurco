// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArticleEditor } from '../src/components/ArticleEditor'

const CONTENT = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Stored article body' }],
    },
  ],
}

const fetchMock = vi.fn(
  async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
)

beforeEach(() => {
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** Renders the island and waits for the TipTap editor to mount. */
async function renderEditor(
  editable: boolean,
  content: Record<string, unknown> = CONTENT,
) {
  let editor: Editor | null = null
  const utils = render(
    <ArticleEditor
      articleId={7}
      editable={editable}
      initialContent={content}
      autosaveDelayMs={30}
      onReady={(instance) => {
        editor = instance
      }}
    />,
  )
  await waitFor(() => {
    expect(editor).not.toBeNull()
    expect(utils.container.querySelector('.tiptap')).toBeTruthy()
  })
  if (!editor) throw new Error('unreachable')
  return { ...utils, editor: editor as Editor }
}

describe('ArticleEditor — read-only mode', () => {
  it('renders the document with zero toolbar/chrome DOM nodes', async () => {
    const { container } = await renderEditor(false)
    expect(screen.getByText('Stored article body')).toBeTruthy()
    // "No toolbar or editing chrome" (DESIGN): not a single button, toolbar,
    // select or input anywhere in the tree.
    expect(container.querySelectorAll('button')).toHaveLength(0)
    expect(container.querySelectorAll('[role="toolbar"]')).toHaveLength(0)
    expect(container.querySelectorAll('select, input')).toHaveLength(0)
  })

  it('is not editable', async () => {
    const { container, editor } = await renderEditor(false)
    expect(editor.isEditable).toBe(false)
    const prosemirror = container.querySelector('.tiptap')
    expect(prosemirror?.getAttribute('contenteditable')).toBe('false')
  })

  it('never autosaves', async () => {
    const { editor } = await renderEditor(false)
    act(() => {
      editor.commands.setContent(CONTENT)
    })
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('opens an article containing a videoEmbed node without crashing', async () => {
    const { container } = await renderEditor(false, {
      type: 'doc',
      content: [
        {
          type: 'videoEmbed',
          attrs: {
            provider: 'youtube',
            src: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
          },
        },
      ],
    })
    expect(container.querySelector('iframe')).toBeTruthy()
  })
})

describe('ArticleEditor — editable mode', () => {
  it('renders the toolbar with the required controls', async () => {
    const { container } = await renderEditor(true)
    const toolbar = screen.getByRole('toolbar')
    expect(toolbar).toBeTruthy()
    // Spot-check the REQUIREMENTS feature set is reachable from the toolbar.
    for (const name of [
      'Heading 2',
      'Quote',
      'Bold',
      'Italic',
      'Strikethrough',
      'Bullet list',
      'Numbered list',
      'Indent',
      'Outdent',
      'Link',
      'Image',
    ]) {
      expect(screen.getByTitle(name)).toBeTruthy()
    }
    expect(screen.getByTitle('Text color')).toBeTruthy()
    expect(screen.getByTitle('Font family')).toBeTruthy()
    expect(screen.getByLabelText('Font size')).toBeTruthy()
    expect(screen.getByTitle('Reset font size')).toBeTruthy()
    expect(screen.getByTitle('Clear formatting')).toBeTruthy()
    for (const font of [
      'Reading Serif',
      'Reading Sans',
      'Plex Mono',
      'Unbounded',
    ]) {
      expect(screen.getByRole('option', { name: font })).toBeTruthy()
    }
    const prosemirror = container.querySelector('.tiptap')
    expect(prosemirror?.getAttribute('contenteditable')).toBe('true')
  })

  it('sets a font size on selected text via the toolbar input', async () => {
    const { editor } = await renderEditor(true, {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'resize me' }] },
      ],
    })
    act(() => {
      editor.commands.selectAll()
    })
    const input = screen.getByLabelText('Font size') as HTMLInputElement
    fireEvent.change(input, { target: { value: '24' } })
    expect(editor.getHTML()).toContain('font-size: 24px')
  })

  it('clamps an out-of-range font size on blur', async () => {
    const { editor } = await renderEditor(true, {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'resize me' }] },
      ],
    })
    act(() => {
      editor.commands.selectAll()
    })
    const input = screen.getByLabelText('Font size') as HTMLInputElement
    fireEvent.change(input, { target: { value: '999' } })
    fireEvent.blur(input)
    expect(editor.getHTML()).toContain('font-size: 72px')
  })

  it('clears the font size via the reset button', async () => {
    const { editor } = await renderEditor(true, {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'resize me',
              marks: [{ type: 'textStyle', attrs: { fontSize: '24px' } }],
            },
          ],
        },
      ],
    })
    act(() => {
      editor.commands.selectAll()
    })
    fireEvent.click(screen.getByTitle('Reset font size'))
    expect(editor.getHTML()).not.toContain('font-size')
  })

  it('clears color/font overrides but keeps bold via "Clear formatting"', async () => {
    const { editor } = await renderEditor(true, {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'styled',
              marks: [
                { type: 'bold' },
                {
                  type: 'textStyle',
                  attrs: {
                    color: '#ff0000',
                    fontFamily: 'Georgia',
                    fontSize: '24px',
                  },
                },
              ],
            },
          ],
        },
      ],
    })
    act(() => {
      editor.commands.selectAll()
    })
    fireEvent.click(screen.getByTitle('Clear formatting'))
    const html = editor.getHTML()
    expect(html).toContain('<strong>styled</strong>')
    expect(html).not.toContain('color')
    expect(html).not.toContain('font-family')
    expect(html).not.toContain('font-size')
  })

  it('autosaves content changes with a debounced PATCH', async () => {
    const { editor } = await renderEditor(true)
    act(() => {
      editor.commands.insertContentAt(editor.state.doc.content.size, {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Fresh words' }],
      })
    })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe('/api/articles/7')
    expect(init.method).toBe('PATCH')
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' })
    const body = JSON.parse(String(init.body)) as {
      content: Record<string, unknown>
    }
    expect(JSON.stringify(body.content)).toContain('Fresh words')
  })

  it('collapses rapid edits into a single PATCH', async () => {
    const { editor } = await renderEditor(true)
    act(() => {
      for (const word of ['one', 'two', 'three']) {
        editor.commands.insertContentAt(editor.state.doc.content.size, {
          type: 'paragraph',
          content: [{ type: 'text', text: word }],
        })
      }
    })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    // The single body carries the final state including every edit.
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(String(init.body)).toContain('three')
  })

  it('shows a subtle saved indicator after a successful autosave', async () => {
    const { editor } = await renderEditor(true)
    act(() => {
      editor.commands.insertContentAt(editor.state.doc.content.size, {
        type: 'paragraph',
        content: [{ type: 'text', text: 'x' }],
      })
    })
    await screen.findByText('Saved')
  })

  it('reports a failed autosave', async () => {
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 500 }))
    const { editor } = await renderEditor(true)
    act(() => {
      editor.commands.insertContentAt(editor.state.doc.content.size, {
        type: 'paragraph',
        content: [{ type: 'text', text: 'x' }],
      })
    })
    await screen.findByText('Save failed')
  })

  it('flushes a pending autosave on unmount with keepalive', async () => {
    const { editor, unmount } = await renderEditor(true)
    act(() => {
      editor.commands.insertContentAt(editor.state.doc.content.size, {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Last words' }],
      })
    })
    unmount() // before the debounce elapses

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe('/api/articles/7')
    expect(init.method).toBe('PATCH')
    expect(init.keepalive).toBe(true)
    expect(String(init.body)).toContain('Last words')
  })

  it('never overlaps PATCHes — an edit mid-flight re-fires after completion', async () => {
    let release: ((response: Response) => void) | undefined
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve
        }),
    )
    const { editor } = await renderEditor(true)
    const insert = (text: string) =>
      act(() => {
        editor.commands.insertContentAt(editor.state.doc.content.size, {
          type: 'paragraph',
          content: [{ type: 'text', text }],
        })
      })

    insert('first')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    // Edit while the first PATCH hangs; its debounce elapses mid-flight.
    insert('second')
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(fetchMock).toHaveBeenCalledTimes(1) // no concurrent PATCH

    act(() => {
      release?.(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const [, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit]
    expect(String(init.body)).toContain('second')
    await screen.findByText('Saved')
  })

  it('keeps the live instance in sync when the editable prop flips', async () => {
    const { editor, rerender } = await renderEditor(true)
    rerender(
      <ArticleEditor
        articleId={7}
        editable={false}
        initialContent={CONTENT}
        autosaveDelayMs={30}
      />,
    )
    await waitFor(() => {
      expect(editor.isEditable).toBe(false)
    })
  })
})

describe('ArticleEditor — link clicks', () => {
  const LINK_CONTENT = {
    type: 'doc',
    content: [
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
    ],
  }

  it('a plain click places the cursor instead of opening the link', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const { container } = await renderEditor(true, LINK_CONTENT)
    const link = container.querySelector('a')
    expect(link).toBeTruthy()

    fireEvent.click(link as HTMLAnchorElement)

    expect(openSpy).not.toHaveBeenCalled()
  })

  it('Cmd/Ctrl+click opens the link in a new tab without editing', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const { container, editor } = await renderEditor(true, LINK_CONTENT)
    const link = container.querySelector('a') as HTMLAnchorElement
    const contentBefore = editor.getJSON()

    fireEvent.click(link, { ctrlKey: true })

    expect(openSpy).toHaveBeenCalledWith(
      link.href,
      '_blank',
      'noopener,noreferrer',
    )
    expect(editor.getJSON()).toEqual(contentBefore)
  })

  it('Cmd+click (metaKey) also opens the link', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const { container } = await renderEditor(true, LINK_CONTENT)
    const link = container.querySelector('a') as HTMLAnchorElement

    fireEvent.click(link, { metaKey: true })

    expect(openSpy).toHaveBeenCalledWith(
      link.href,
      '_blank',
      'noopener,noreferrer',
    )
  })

  it('adds a pointer-cursor hint class while Ctrl/Cmd is held, removes it on keyup', async () => {
    const { container } = await renderEditor(true, LINK_CONTENT)
    const doc = container.querySelector('.article-doc') as HTMLElement
    expect(doc.classList.contains('meta-pressed')).toBe(false)

    fireEvent.keyDown(window, { key: 'Control' })
    expect(doc.classList.contains('meta-pressed')).toBe(true)

    fireEvent.keyUp(window, { key: 'Control' })
    expect(doc.classList.contains('meta-pressed')).toBe(false)
  })

  it('clears the hint on window blur, so it never gets stuck after switching apps', async () => {
    const { container } = await renderEditor(true, LINK_CONTENT)
    const doc = container.querySelector('.article-doc') as HTMLElement

    fireEvent.keyDown(window, { key: 'Meta' })
    expect(doc.classList.contains('meta-pressed')).toBe(true)

    fireEvent(window, new Event('blur'))
    expect(doc.classList.contains('meta-pressed')).toBe(false)
  })
})
