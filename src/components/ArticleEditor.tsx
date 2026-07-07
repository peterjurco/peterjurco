import type { Editor } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import { documentExtensions } from '../lib/articles/extensions'
import { EditorToolbar } from './EditorToolbar'
import './article-editor.css'

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

interface ArticleEditorProps {
  articleId: number
  editable: boolean
  initialContent: Record<string, unknown>
  /** Debounce before the autosave PATCH fires. Overridable for tests. */
  autosaveDelayMs?: number
  /** Test hook — hands out the TipTap instance once mounted. */
  onReady?: (editor: Editor) => void
}

const SAVE_LABELS: Record<SaveState, string> = {
  idle: '',
  dirty: 'Saving…',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Save failed',
}

/**
 * The Google-Docs-style article island (TECH_DECISIONS §2): one component,
 * `editable` driven by permission. Read-only renders the document alone —
 * no toolbar, no chrome, zero interactive DOM nodes.
 */
export function ArticleEditor({
  articleId,
  editable,
  initialContent,
  autosaveDelayMs = 800,
  onReady,
}: ArticleEditorProps) {
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  /** Latest unsaved document — null when everything typed has been sent. */
  const pendingContent = useRef<Record<string, unknown> | null>(null)
  const inFlight = useRef(false)

  const editor = useEditor({
    extensions: documentExtensions(),
    content: initialContent,
    editable,
    // The island is server-rendered by Astro first — create the editor only
    // after hydration.
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      if (!editor.isEditable) return
      // Capture the JSON now: at unmount time the editor is already destroyed.
      pendingContent.current = editor.getJSON()
      setSaveState('dirty')
      clearTimeout(debounceTimer.current)
      debounceTimer.current = setTimeout(() => void flush(), autosaveDelayMs)
    },
  })

  /**
   * Sends the pending document. Saves are serialized — never two PATCHes in
   * flight: edits arriving mid-flight stay pending and re-fire on completion,
   * and a response for an already-stale document never drives the indicator.
   */
  async function flush(): Promise<void> {
    if (inFlight.current) return // the in-flight save re-fires on completion
    const content = pendingContent.current
    if (content === null) return
    pendingContent.current = null
    inFlight.current = true
    setSaveState('saving')
    try {
      const response = await fetch(`/api/articles/${articleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      if (pendingContent.current === null) {
        setSaveState(response.ok ? 'saved' : 'error')
      }
    } catch {
      if (pendingContent.current === null) setSaveState('error')
    } finally {
      inFlight.current = false
      if (pendingContent.current !== null) void flush()
    }
  }

  useEffect(() => {
    if (editor && onReady) onReady(editor)
  }, [editor, onReady])

  // Keep the live instance in sync when the `editable` prop changes.
  useEffect(() => {
    if (editor && editor.isEditable !== editable) editor.setEditable(editable)
  }, [editor, editable])

  // Unsaved work must survive navigation/unmount: flush whatever is still
  // pending with keepalive so the request outlives the page.
  useEffect(() => {
    return () => {
      clearTimeout(debounceTimer.current)
      const content = pendingContent.current
      pendingContent.current = null
      if (content === null) return
      void fetch(`/api/articles/${articleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
        keepalive: true,
      })
    }
  }, [articleId])

  // While dirty or saving, warn before the tab closes; gone once saved.
  useEffect(() => {
    if (saveState !== 'dirty' && saveState !== 'saving') return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [saveState])

  return (
    <div className="article-editor">
      {editable && editor && (
        <EditorToolbar editor={editor} saveLabel={SAVE_LABELS[saveState]} />
      )}
      <EditorContent editor={editor} className="article-doc article-body" />
    </div>
  )
}
