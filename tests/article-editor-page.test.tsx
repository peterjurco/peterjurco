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
import { ArticleMetaPanel } from '../src/components/ArticleMetaPanel'
import { resetSaveStatus } from '../src/lib/articles/save-status'

const CONTENT = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
}

const fetchMock = vi.fn(
  async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
)

beforeEach(() => {
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  resetSaveStatus()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  resetSaveStatus()
})

/** Mirrors the real composition in src/pages/app/articles/[id].astro. */
async function renderPage() {
  let editor: Editor | null = null
  const utils = render(
    <>
      <ArticleMetaPanel
        articleId={7}
        publicId="pub-7"
        initialTitle="Hello"
        initialVisibility="private"
        initialCategoryId={null}
        initialTags={[]}
        initialIsFeatured={false}
        categories={[]}
        allTagNames={[]}
        topTagsByCategory={{}}
        createdToday={false}
        debounceMs={30}
      />
      <ArticleEditor
        articleId={7}
        editable={true}
        initialContent={CONTENT}
        autosaveDelayMs={30}
        onReady={(instance) => {
          editor = instance
        }}
      />
    </>,
  )
  await waitFor(() => expect(editor).not.toBeNull())
  return { ...utils, editor: editor as unknown as Editor }
}

describe('Article editor page — one unified save indicator', () => {
  it('never shows more than one save-status element at a time, for a metadata edit', async () => {
    await renderPage()
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'New title' },
    })
    await waitFor(() => expect(screen.getAllByText('Saving…')).toHaveLength(1))
    await waitFor(() => expect(screen.getAllByText('Saved')).toHaveLength(1))
  })

  it('never shows more than one save-status element at a time, for a content edit', async () => {
    const { editor } = await renderPage()
    act(() => {
      editor.commands.insertContentAt(editor.state.doc.content.size, {
        type: 'paragraph',
        content: [{ type: 'text', text: 'more' }],
      })
    })
    await waitFor(() => expect(screen.getAllByText('Saving…')).toHaveLength(1))
    await waitFor(() => expect(screen.getAllByText('Saved')).toHaveLength(1))
  })
})
