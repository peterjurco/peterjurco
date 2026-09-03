// @vitest-environment jsdom

import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { documentExtensions } from '../src/lib/articles/extensions'
import { ImagePasteUpload } from '../src/lib/articles/image-paste-upload'

afterEach(() => {
  vi.unstubAllGlobals()
})

function createEditor(): Editor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  return new Editor({
    element,
    extensions: [...documentExtensions(), ImagePasteUpload],
    content: '<p></p>',
  })
}

/** Simulates a real clipboard paste carrying image file(s). */
function firePaste(editor: Editor, files: File[]): void {
  const event = new Event('paste', {
    bubbles: true,
    cancelable: true,
  }) as ClipboardEvent
  Object.defineProperty(event, 'clipboardData', {
    value: { files, items: [], types: [], getData: () => '' },
  })
  editor.view.dom.dispatchEvent(event)
}

describe('ImagePasteUpload', () => {
  const file = new File(['bytes'], 'screenshot.png', { type: 'image/png' })

  it('shows a placeholder immediately and leaves the document unchanged while uploading', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})), // never resolves
    )
    const editor = createEditor()
    const before = editor.getJSON()

    firePaste(editor, [file])

    expect(
      editor.view.dom.querySelector('.image-paste-placeholder'),
    ).not.toBeNull()
    expect(editor.getJSON()).toEqual(before)
    editor.destroy()
  })

  it('replaces the placeholder with a real image node on a successful upload', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === '/api/media/presign'
        ? Response.json({ url: 'http://s3/put', key: 'articles/done.png' })
        : new Response(null, { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const editor = createEditor()

    firePaste(editor, [file])
    await vi.waitFor(() => {
      expect(
        editor.view.dom.querySelector('.image-paste-placeholder'),
      ).toBeNull()
    })

    const imageNode = editor
      .getJSON()
      .content?.find((node) => node.type === 'image')
    expect(imageNode?.attrs?.src).toContain('articles/done.png')
    editor.destroy()
  })

  it('keeps the pending upload anchored to its position when the document changes before it resolves', async () => {
    // A controllable presign response: the upload stays pending until the
    // test explicitly resolves it, so a document edit can be made in
    // between the paste and the upload landing.
    let resolvePresign!: (response: Response) => void
    const presign = new Promise<Response>((resolve) => {
      resolvePresign = resolve
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === '/api/media/presign'
        ? presign
        : new Response(null, { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const editor = createEditor()

    firePaste(editor, [file])
    expect(
      editor.view.dom.querySelector('.image-paste-placeholder'),
    ).not.toBeNull()

    // Type before the placeholder's anchored position (1, the start of the
    // empty paragraph the paste landed in) while the upload is still in
    // flight. Without tr.mapping remapping in the plugin's apply(), the
    // stored position would stay stale at 1 and the image would land
    // *before* this text instead of after it.
    editor.chain().insertContentAt(1, 'Hello ').run()

    resolvePresign(
      Response.json({ url: 'http://s3/put', key: 'articles/anchored.png' }),
    )
    await vi.waitFor(() => {
      expect(
        editor.view.dom.querySelector('.image-paste-placeholder'),
      ).toBeNull()
    })

    const content = editor.getJSON().content ?? []
    const textIndex = content.findIndex((node) =>
      node.content?.some(
        (child) =>
          child.type === 'text' &&
          'text' in child &&
          typeof child.text === 'string' &&
          child.text.includes('Hello'),
      ),
    )
    const imageIndex = content.findIndex((node) => node.type === 'image')
    expect(textIndex).toBeGreaterThanOrEqual(0)
    expect(imageIndex).toBeGreaterThan(textIndex)
    editor.destroy()
  })

  it('shows a dismissable inline error on failure, without touching the document', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 })),
    )
    const editor = createEditor()
    const before = editor.getJSON()

    firePaste(editor, [file])
    await vi.waitFor(() => {
      expect(editor.view.dom.querySelector('.image-paste-error')).not.toBeNull()
    })
    expect(editor.getJSON()).toEqual(before)

    const dismiss = editor.view.dom.querySelector<HTMLButtonElement>(
      '.image-paste-error button',
    )
    dismiss?.click()
    expect(editor.view.dom.querySelector('.image-paste-error')).toBeNull()
    editor.destroy()
  })

  it('ignores a paste with no image files, so normal text paste still works', () => {
    vi.stubGlobal('fetch', vi.fn())
    const editor = createEditor()

    firePaste(editor, [])

    expect(editor.view.dom.querySelector('.image-paste-placeholder')).toBeNull()
    editor.destroy()
  })

  /**
   * Guards against a real bug: navigating away right after pasting destroys
   * the editor while the upload is still in flight. TipTap's Editor.destroy()
   * nulls out internal state, so the pending .then()/.catch() callbacks must
   * bail out via `editor.isDestroyed` before touching `editor.chain()` /
   * `editor.view` — otherwise they throw inside a promise callback with
   * nothing to catch it, surfacing as an unhandled rejection.
   */
  async function expectNoUnhandledRejection(
    trigger: () => void,
  ): Promise<void> {
    const rejections: unknown[] = []
    const onUnhandledRejection = (reason: unknown) => rejections.push(reason)
    process.on('unhandledRejection', onUnhandledRejection)
    try {
      trigger()
      // Flush the promise chain inside uploadImage() (presign fetch -> PUT
      // fetch -> the plugin's .then()/.catch()).
      await new Promise((resolve) => setTimeout(resolve, 10))
    } finally {
      process.off('unhandledRejection', onUnhandledRejection)
    }
    expect(rejections).toEqual([])
  }

  it('does not throw when a successful upload resolves after the editor is destroyed', async () => {
    let resolvePresign!: (response: Response) => void
    const presign = new Promise<Response>((resolve) => {
      resolvePresign = resolve
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === '/api/media/presign'
        ? presign
        : new Response(null, { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const editor = createEditor()

    firePaste(editor, [file])
    editor.destroy()

    await expectNoUnhandledRejection(() => {
      resolvePresign(
        Response.json({ url: 'http://s3/put', key: 'articles/late.png' }),
      )
    })
  })

  it('does not throw when a failed upload rejects after the editor is destroyed', async () => {
    let rejectPresign!: (error: unknown) => void
    const presign = new Promise<Response>((_resolve, reject) => {
      rejectPresign = reject
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => presign),
    )
    const editor = createEditor()

    firePaste(editor, [file])
    editor.destroy()

    await expectNoUnhandledRejection(() => {
      rejectPresign(new Error('boom'))
    })
  })
})
