import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import {
  addRecentColor,
  getRecentColors,
  resolveCurrentColor,
} from './color-picker-utils'

/**
 * The article editor's text-color control: a trigger swatch (showing the
 * current color — the explicit mark, or the real rendered color when none
 * is set, see color-picker-utils.ts) that opens a popover with a fixed
 * 10-color palette tailored to the site, a "recently used" row (localStorage,
 * capped at 5, MRU with de-dup), and one more swatch that opens the native
 * `<input type="color">` for anything outside the palette.
 */

export const PRESET_COLORS = [
  { label: 'Ink', hex: '#17140f' },
  { label: 'Warm gray', hex: '#6e655c' },
  { label: 'Terracotta', hex: '#c1793a' },
  { label: 'Rust', hex: '#a13d2e' },
  { label: 'Forest green', hex: '#4b6b4c' },
  { label: 'Deep navy', hex: '#2c4a6e' },
  { label: 'Mustard gold', hex: '#c9a227' },
  { label: 'Plum', hex: '#6b3a4a' },
  { label: 'Cream', hex: '#f0e7d3' },
  { label: 'Charcoal blue-gray', hex: '#3a4048' },
] as const

interface ColorSwatchPickerProps {
  editor: Editor
}

export function ColorSwatchPicker({ editor }: ColorSwatchPickerProps) {
  const [open, setOpen] = useState(false)
  const [recents, setRecents] = useState<string[]>(() => getRecentColors())
  const containerRef = useRef<HTMLDivElement>(null)

  const currentColor = useEditorState({
    editor,
    selector: ({ editor }) => resolveCurrentColor(editor),
  })

  useEffect(() => {
    if (!open) return
    function handlePointerDown(event: MouseEvent): void {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  function pick(hex: string): void {
    editor.chain().focus().setColor(hex).run()
    setRecents(addRecentColor(hex))
    setOpen(false)
  }

  return (
    <div className="color-swatch-picker" ref={containerRef}>
      <button
        type="button"
        title="Text color"
        aria-label="Text color"
        className="color-swatch color-swatch-trigger"
        style={{ backgroundColor: currentColor }}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((value) => !value)}
      />
      {open && (
        <div className="color-swatch-popover" role="menu">
          <div className="color-swatch-row">
            {PRESET_COLORS.map(({ label, hex }) => (
              <button
                key={hex}
                type="button"
                title={label}
                aria-label={label}
                className="color-swatch"
                style={{ backgroundColor: hex }}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(hex)}
              />
            ))}
          </div>
          {recents.length > 0 && (
            <div className="color-swatch-row color-swatch-row-recent">
              {recents.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  title={hex}
                  aria-label={`Recent color ${hex}`}
                  className="color-swatch"
                  style={{ backgroundColor: hex }}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pick(hex)}
                />
              ))}
            </div>
          )}
          <label
            className="color-swatch color-swatch-custom"
            title="Custom color"
          >
            <input
              type="color"
              aria-label="Custom color"
              value={currentColor}
              onChange={(event) => pick(event.target.value)}
            />
          </label>
        </div>
      )}
    </div>
  )
}
