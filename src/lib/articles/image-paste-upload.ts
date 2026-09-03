import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { imageUrl } from '../media/image-url'
import { ACCEPTED_IMAGE_TYPES, uploadImage } from '../media/upload-image'
import { newPublicId } from '../public-id'

/**
 * Paste-to-upload for the article body
 * (docs/superpowers/specs/2026-09-03-paste-image-upload-design.md): pasting
 * an image shows a spinner decoration at the cursor, uploads it in the
 * background, then replaces the decoration with a real `image` node.
 *
 * Editor-only — deliberately NOT part of documentExtensions() — because the
 * placeholder/error state lives entirely in ProseMirror decorations, never
 * in the document itself: `editor.getJSON()` never sees it, so a mid-upload
 * autosave can never persist a half-finished paste.
 */

interface PendingImage {
  pos: number
  status: 'uploading' | 'error'
  message?: string
}

type Action =
  | { type: 'add'; id: string; pos: number }
  | { type: 'error'; id: string; message: string }
  | { type: 'remove'; id: string }

const pasteUploadKey = new PluginKey<Map<string, PendingImage>>(
  'imagePasteUpload',
)

function applyAction(state: Map<string, PendingImage>, action: Action): void {
  if (action.type === 'add') {
    state.set(action.id, { pos: action.pos, status: 'uploading' })
  } else if (action.type === 'error') {
    const entry = state.get(action.id)
    if (entry) {
      state.set(action.id, {
        ...entry,
        status: 'error',
        message: action.message,
      })
    }
  } else {
    state.delete(action.id)
  }
}

function renderSpinner(): HTMLElement {
  const span = document.createElement('span')
  span.className = 'image-paste-placeholder'
  span.textContent = 'Uploading image…'
  return span
}

function renderError(message: string, onDismiss: () => void): HTMLElement {
  const span = document.createElement('span')
  span.className = 'image-paste-error'
  span.textContent = `${message} `
  const dismiss = document.createElement('button')
  dismiss.type = 'button'
  dismiss.className = 'image-paste-dismiss'
  dismiss.textContent = '✕'
  dismiss.setAttribute('aria-label', 'Dismiss')
  dismiss.addEventListener('mousedown', (event) => event.preventDefault())
  dismiss.addEventListener('click', onDismiss)
  span.appendChild(dismiss)
  return span
}

export const ImagePasteUpload = Extension.create({
  name: 'imagePasteUpload',

  addProseMirrorPlugins() {
    const editor = this.editor

    return [
      new Plugin<Map<string, PendingImage>>({
        key: pasteUploadKey,

        state: {
          init: () => new Map(),
          apply(tr, prev) {
            const next = new Map<string, PendingImage>()
            for (const [id, entry] of prev) {
              next.set(id, { ...entry, pos: tr.mapping.map(entry.pos) })
            }
            const action = tr.getMeta(pasteUploadKey) as Action | undefined
            if (action) applyAction(next, action)
            return next
          },
        },

        props: {
          decorations(state) {
            const pending = pasteUploadKey.getState(state)
            if (!pending || pending.size === 0) return null
            const decorations = Array.from(pending, ([id, entry]) =>
              entry.status === 'uploading'
                ? Decoration.widget(entry.pos, renderSpinner, { side: 1 })
                : Decoration.widget(
                    entry.pos,
                    () =>
                      renderError(entry.message ?? 'Upload failed', () => {
                        editor.view.dispatch(
                          editor.view.state.tr.setMeta(pasteUploadKey, {
                            type: 'remove',
                            id,
                          } satisfies Action),
                        )
                      }),
                    { side: 1, stopEvent: () => true },
                  ),
            )
            return DecorationSet.create(state.doc, decorations)
          },

          handlePaste(view, event) {
            const files = Array.from(event.clipboardData?.files ?? []).filter(
              (file) => ACCEPTED_IMAGE_TYPES.includes(file.type),
            )
            if (files.length === 0) return false

            for (const file of files) {
              const id = newPublicId()
              const pos = view.state.selection.from
              view.dispatch(
                view.state.tr.setMeta(pasteUploadKey, {
                  type: 'add',
                  id,
                  pos,
                } satisfies Action),
              )

              uploadImage(file, 'articles').then(
                (key) => {
                  if (editor.isDestroyed) return
                  const current = pasteUploadKey.getState(editor.state)?.get(id)
                  editor
                    .chain()
                    .insertContentAt(current?.pos ?? pos, {
                      type: 'image',
                      attrs: { src: imageUrl(key) },
                    })
                    .run()
                  editor.view.dispatch(
                    editor.view.state.tr.setMeta(pasteUploadKey, {
                      type: 'remove',
                      id,
                    } satisfies Action),
                  )
                },
                (error: unknown) => {
                  if (editor.isDestroyed) return
                  editor.view.dispatch(
                    editor.view.state.tr.setMeta(pasteUploadKey, {
                      type: 'error',
                      id,
                      message:
                        error instanceof Error
                          ? error.message
                          : 'Upload failed',
                    } satisfies Action),
                  )
                },
              )
            }
            return true
          },
        },
      }),
    ]
  },
})
