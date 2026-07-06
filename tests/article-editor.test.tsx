// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
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
async function renderEditor(editable: boolean) {
  let editor: Editor | null = null
  const utils = render(
    <ArticleEditor
      articleId={7}
      editable={editable}
      initialContent={CONTENT}
      autosaveDelayMs={30}
      onReady={(instance) => {
        editor = instance
      }}
    />,
  )
  await screen.findByText('Stored article body')
  await waitFor(() => {
    expect(editor).not.toBeNull()
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
    const prosemirror = container.querySelector('.tiptap')
    expect(prosemirror?.getAttribute('contenteditable')).toBe('true')
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
})
