import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'

interface EditorToolbarProps {
  editor: Editor
  /** Subtle autosave indicator text; empty until the first edit. */
  saveLabel: string
}

const FONT_FAMILIES = [
  { label: 'Font', value: '' },
  { label: 'Serif', value: 'Georgia, serif' },
  { label: 'Sans', value: 'Helvetica, Arial, sans-serif' },
  { label: 'Mono', value: 'Menlo, Consolas, monospace' },
]

interface ToolbarButtonProps {
  title: string
  label: string
  active?: boolean
  onClick: () => void
}

function ToolbarButton({ title, label, active, onClick }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active ?? false}
      className={active ? 'is-active' : undefined}
      // Keep the text selection in the editor — focus must not jump to the
      // toolbar on tap (matters on mobile keyboards too).
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

/** Shown only when the article is editable — read-only mode renders nothing. */
export function EditorToolbar({ editor, saveLabel }: EditorToolbarProps) {
  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      heading2: editor.isActive('heading', { level: 2 }),
      heading3: editor.isActive('heading', { level: 3 }),
      blockquote: editor.isActive('blockquote'),
      bold: editor.isActive('bold'),
      italic: editor.isActive('italic'),
      strike: editor.isActive('strike'),
      bulletList: editor.isActive('bulletList'),
      orderedList: editor.isActive('orderedList'),
      link: editor.isActive('link'),
      color:
        (editor.getAttributes('textStyle').color as string | undefined) ??
        '#000000',
      fontFamily:
        (editor.getAttributes('textStyle').fontFamily as string | undefined) ??
        '',
    }),
  })

  function setLink(): void {
    if (editor.isActive('link')) {
      editor.chain().focus().unsetLink().run()
      return
    }
    const href = window.prompt('Link URL')
    if (!href) return
    editor.chain().focus().setLink({ href }).run()
  }

  function insertImage(): void {
    const src = window.prompt('Image URL')
    if (!src) return
    editor.chain().focus().setImage({ src }).run()
  }

  return (
    <div className="editor-toolbar" role="toolbar" aria-label="Formatting">
      <ToolbarButton
        title="Heading 2"
        label="H2"
        active={state.heading2}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      />
      <ToolbarButton
        title="Heading 3"
        label="H3"
        active={state.heading3}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      />
      <ToolbarButton
        title="Quote"
        label="❝"
        active={state.blockquote}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      />
      <span className="editor-toolbar-divider" />
      <ToolbarButton
        title="Bold"
        label="B"
        active={state.bold}
        onClick={() => editor.chain().focus().toggleBold().run()}
      />
      <ToolbarButton
        title="Italic"
        label="I"
        active={state.italic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      />
      <ToolbarButton
        title="Strikethrough"
        label="S"
        active={state.strike}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      />
      <label className="editor-toolbar-color" title="Text color">
        <input
          type="color"
          aria-label="Text color"
          value={state.color}
          onChange={(event) =>
            editor.chain().focus().setColor(event.target.value).run()
          }
        />
      </label>
      <select
        title="Font family"
        aria-label="Font family"
        value={state.fontFamily}
        onChange={(event) => {
          const value = event.target.value
          if (value === '') {
            editor.chain().focus().unsetFontFamily().run()
          } else {
            editor.chain().focus().setFontFamily(value).run()
          }
        }}
      >
        {FONT_FAMILIES.map((font) => (
          <option key={font.label} value={font.value}>
            {font.label}
          </option>
        ))}
      </select>
      <span className="editor-toolbar-divider" />
      <ToolbarButton
        title="Bullet list"
        label="•"
        active={state.bulletList}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      />
      <ToolbarButton
        title="Numbered list"
        label="1."
        active={state.orderedList}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      />
      <ToolbarButton
        title="Indent"
        label="→"
        onClick={() => editor.chain().focus().sinkListItem('listItem').run()}
      />
      <ToolbarButton
        title="Outdent"
        label="←"
        onClick={() => editor.chain().focus().liftListItem('listItem').run()}
      />
      <span className="editor-toolbar-divider" />
      <ToolbarButton
        title="Link"
        label="🔗"
        active={state.link}
        onClick={setLink}
      />
      <ToolbarButton title="Image" label="🖼" onClick={insertImage} />
      <span className="editor-save-state" aria-live="polite">
        {saveLabel}
      </span>
    </div>
  )
}
