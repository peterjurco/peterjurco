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

  const editor = useEditor({
    extensions: documentExtensions(),
    content: initialContent,
    editable,
    // The island is server-rendered by Astro first — create the editor only
    // after hydration.
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      if (!editor.isEditable) return
      setSaveState('dirty')
      clearTimeout(debounceTimer.current)
      debounceTimer.current = setTimeout(() => {
        void save(editor)
      }, autosaveDelayMs)
    },
  })

  async function save(editor: Editor): Promise<void> {
    setSaveState('saving')
    try {
      const response = await fetch(`/api/articles/${articleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editor.getJSON() }),
      })
      setSaveState(response.ok ? 'saved' : 'error')
    } catch {
      setSaveState('error')
    }
  }

  useEffect(() => {
    if (editor && onReady) onReady(editor)
  }, [editor, onReady])

  // Never leave a scheduled save behind after unmount.
  useEffect(() => () => clearTimeout(debounceTimer.current), [])

  return (
    <div className="article-editor">
      {editable && editor && (
        <EditorToolbar editor={editor} saveLabel={SAVE_LABELS[saveState]} />
      )}
      <EditorContent editor={editor} className="article-doc" />
    </div>
  )
}
