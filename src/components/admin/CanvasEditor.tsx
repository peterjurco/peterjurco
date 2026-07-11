import { useEffect, useRef, useState } from 'react'
import {
  CANVAS_ASPECT_CSS,
  TILE_RANGES,
  type TileBorder,
} from '../../lib/home/canvas'
import { envImageUrlConfig, imageUrl } from '../../lib/media/image-url'
import { CoverUpload } from '../CoverUpload'
import { TileInspector } from './TileInspector'
import './canvas-editor.css'

/**
 * Freeform canvas editor for the public homepage (REQUIREMENTS "Admin edit
 * model"): Canva-style — every block can be moved (drag / arrow keys),
 * resized (corner handle), rotated (handle above the tile) and styled
 * (border, hover effect) via the TileInspector. Save PUTs the COMPLETE
 * canvas to /api/home/tiles (bulkUpsertLayout semantics: ids update, id-less
 * insert, missing rows are deleted).
 *
 * Geometry matches the public renderer: percentages of the fixed-aspect
 * canvas (src/lib/home/canvas.ts). Dragging uses raw pointer events with
 * pointer capture — no DnD library; jsdom drives the same handlers in tests.
 */

export interface EditorTile {
  /** DB id; undefined for tiles not yet persisted. */
  id?: number
  kind: 'photo' | 'quote'
  /** Ordered R2 object keys — for `photo` tiles. */
  imageKeys: string[]
  textContent: string | null
  cite: string | null
  x: number
  y: number
  width: number
  height: number
  rotation: number
  border: TileBorder | null
  hoverEffect: string | null
  zIndex: number
  /** ms per image while cycling; null = CycleGroup's default. */
  cycleIntervalMs: number | null
}

type Keyed = EditorTile & { clientKey: number }

type Status = '' | 'Saving…' | 'Saved' | 'Save failed'

type DragMode = 'move' | 'resize' | 'rotate'

interface DragState {
  mode: DragMode
  pointerId: number
  startClientX: number
  startClientY: number
  orig: Pick<EditorTile, 'x' | 'y' | 'width' | 'height' | 'rotation'>
  /** Canvas rect captured at drag start — pointer px → canvas %. */
  rect: DOMRect
  key: number
}

const round1 = (value: number) => Math.round(value * 10) / 10
const clamp = (value: number, { min, max }: { min: number; max: number }) =>
  Math.min(max, Math.max(min, value))

/** Keeps an active-image index inside an array's bounds (0 for an empty one). */
function clampImageIndex(length: number, index: number): number {
  if (length === 0) return 0
  return Math.min(Math.max(index, 0), length - 1)
}

interface CanvasEditorProps {
  /** The persisted canvas in stacking order (listOrdered). */
  initialTiles: EditorTile[]
}

export function CanvasEditor({ initialTiles }: CanvasEditorProps) {
  const nextKey = useRef(0)
  const withKeys = (list: EditorTile[]): Keyed[] =>
    list.map((tile) => ({ ...tile, clientKey: nextKey.current++ }))

  const [tiles, setTiles] = useState<Keyed[]>(() => withKeys(initialTiles))
  const [selectedKey, setSelectedKey] = useState<number | null>(null)
  const [status, setStatus] = useState<Status>('')
  const [uploading, setUploading] = useState(false)
  const [dirty, setDirty] = useState(false)
  // Which image of a photo tile's imageKeys is showing in the inspector —
  // NOT persisted (purely a browsing cursor), keyed by clientKey so it
  // survives reselecting a different tile and back. Absent = index 0.
  const [activeImageIndex, setActiveImageIndexState] = useState<
    Record<number, number>
  >({})
  const canvasRef = useRef<HTMLDivElement>(null)
  const drag = useRef<DragState | null>(null)

  const busy = status === 'Saving…' || uploading
  const selected = tiles.find((tile) => tile.clientKey === selectedKey) ?? null

  function activeIndexFor(tile: Keyed): number {
    return clampImageIndex(
      tile.imageKeys.length,
      activeImageIndex[tile.clientKey] ?? 0,
    )
  }

  function setActiveIndex(key: number, index: number): void {
    setActiveImageIndexState((current) => ({ ...current, [key]: index }))
  }

  // Unsaved-changes warning, active only while dirty.
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      // Legacy channel for older browsers ('' means "cancel the unload").
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  function updateTile(key: number, patch: Partial<EditorTile>): void {
    setTiles((current) =>
      current.map((tile) =>
        tile.clientKey === key ? { ...tile, ...patch } : tile,
      ),
    )
    setDirty(true)
    setStatus('')
  }

  function addTile(tile: Omit<EditorTile, 'zIndex'>): void {
    // Computed OUTSIDE the setTiles updater — updaters must stay pure (React
    // may invoke them twice in StrictMode), and this one used to mutate the
    // key ref and set sibling state inside.
    const topZ = tiles.reduce((top, entry) => Math.max(top, entry.zIndex), 0)
    const keyed: Keyed = {
      ...tile,
      zIndex: topZ + 1,
      clientKey: nextKey.current++,
    }
    setTiles((current) => [...current, keyed])
    setSelectedKey(keyed.clientKey)
    setDirty(true)
    setStatus('')
  }

  function addPhotoTile(imageKey: string): void {
    addTile({
      kind: 'photo',
      imageKeys: [imageKey],
      textContent: null,
      cite: null,
      x: 5,
      y: 5,
      width: 40,
      height: 20,
      rotation: 0,
      border: null,
      hoverEffect: 'develop',
      cycleIntervalMs: null,
    })
  }

  function addQuoteTile(): void {
    addTile({
      kind: 'quote',
      imageKeys: [],
      textContent: 'New quote',
      cite: null,
      x: 30,
      y: 30,
      width: 30,
      height: 12,
      rotation: -1.6,
      border: null,
      hoverEffect: null,
      cycleIntervalMs: null,
    })
  }

  function removeTile(key: number): void {
    setTiles((current) => current.filter((tile) => tile.clientKey !== key))
    // Drop the viewing-cursor entry too — nothing else clears it, and it
    // would otherwise linger forever in this map (clientKeys are monotonic
    // and never reused, so it can never collide with a later tile, but
    // there's no reason to keep growing the map on every delete).
    setActiveImageIndexState((current) => {
      if (!(key in current)) return current
      const { [key]: _removed, ...rest } = current
      return rest
    })
    setSelectedKey(null)
    setDirty(true)
    setStatus('')
  }

  /** Moves the viewing cursor to the previous/next image — pure navigation,
   *  never touches imageKeys order. This is what lets the owner actually
   *  look at every image in a tile (see TileInspector's View prev/next). */
  function viewImage(key: number, direction: -1 | 1): void {
    const tile = tiles.find((entry) => entry.clientKey === key)
    if (!tile) return
    const index = activeIndexFor(tile)
    const target = index + direction
    if (target < 0 || target >= tile.imageKeys.length) return
    setActiveIndex(key, target)
  }

  /** Swaps the currently-viewed image with its previous/next neighbor in
   *  imageKeys (see TileInspector's Move left/right); the viewing cursor
   *  follows the moved image, so repeatedly moving one direction walks it
   *  to an end. */
  function moveActiveImage(key: number, direction: -1 | 1): void {
    const tile = tiles.find((entry) => entry.clientKey === key)
    if (!tile) return
    const index = activeIndexFor(tile)
    const target = index + direction
    if (target < 0 || target >= tile.imageKeys.length) return
    const keys = [...tile.imageKeys]
    const [moved] = keys.splice(index, 1)
    keys.splice(target, 0, moved as string)
    updateTile(key, { imageKeys: keys })
    setActiveIndex(key, target)
  }

  /** Appends a freshly uploaded image and makes it the active one. */
  function addImage(key: number, imageKey: string): void {
    const tile = tiles.find((entry) => entry.clientKey === key)
    if (!tile) return
    const keys = [...tile.imageKeys, imageKey]
    updateTile(key, { imageKeys: keys })
    setActiveIndex(key, keys.length - 1)
  }

  /** Removes the active image — a photo tile must keep at least one. */
  function deleteActiveImage(key: number): void {
    const tile = tiles.find((entry) => entry.clientKey === key)
    if (!tile || tile.imageKeys.length <= 1) return
    const index = activeIndexFor(tile)
    const keys = tile.imageKeys.filter((_, entryIndex) => entryIndex !== index)
    updateTile(key, { imageKeys: keys })
    setActiveIndex(key, clampImageIndex(keys.length, index))
  }

  function beginDrag(
    event: React.PointerEvent<HTMLElement>,
    key: number,
    mode: DragMode,
  ): void {
    const canvas = canvasRef.current
    const tile = tiles.find((entry) => entry.clientKey === key)
    if (!canvas || !tile) return
    event.preventDefault()
    event.stopPropagation()
    setSelectedKey(key)
    // jsdom has no pointer capture — a browser nicety, not a correctness need.
    event.currentTarget.setPointerCapture?.(event.pointerId)
    drag.current = {
      mode,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      orig: {
        x: tile.x,
        y: tile.y,
        width: tile.width,
        height: tile.height,
        rotation: tile.rotation,
      },
      rect: canvas.getBoundingClientRect(),
      key,
    }
  }

  function onDragMove(event: React.PointerEvent<HTMLElement>): void {
    const state = drag.current
    if (!state || event.pointerId !== state.pointerId) return
    const tile = tiles.find((entry) => entry.clientKey === state.key)
    if (!tile) return
    const dx = ((event.clientX - state.startClientX) / state.rect.width) * 100
    const dy = ((event.clientY - state.startClientY) / state.rect.height) * 100

    if (state.mode === 'move') {
      updateTile(state.key, {
        x: clamp(round1(state.orig.x + dx), TILE_RANGES.x),
        y: clamp(round1(state.orig.y + dy), TILE_RANGES.y),
      })
    } else if (state.mode === 'resize') {
      updateTile(state.key, {
        width: clamp(round1(state.orig.width + dx), TILE_RANGES.width),
        height: clamp(round1(state.orig.height + dy), TILE_RANGES.height),
      })
    } else {
      // Rotate: angle of the pointer around the tile center; the handle
      // rests straight above the center (-90°), so that position = 0°.
      const cx =
        state.rect.left + ((tile.x + tile.width / 2) / 100) * state.rect.width
      const cy =
        state.rect.top + ((tile.y + tile.height / 2) / 100) * state.rect.height
      const angle =
        (Math.atan2(event.clientY - cy, event.clientX - cx) * 180) / Math.PI
      updateTile(state.key, {
        rotation: clamp(round1(angle + 90), TILE_RANGES.rotation),
      })
    }
  }

  function endDrag(event: React.PointerEvent<HTMLElement>): void {
    if (drag.current?.pointerId === event.pointerId) drag.current = null
  }

  function nudge(event: React.KeyboardEvent, key: number): void {
    const tile = tiles.find((entry) => entry.clientKey === key)
    if (!tile) return
    const step = event.shiftKey ? 2 : 0.5
    const moves: Record<string, Partial<EditorTile>> = {
      ArrowLeft: { x: clamp(round1(tile.x - step), TILE_RANGES.x) },
      ArrowRight: { x: clamp(round1(tile.x + step), TILE_RANGES.x) },
      ArrowUp: { y: clamp(round1(tile.y - step), TILE_RANGES.y) },
      ArrowDown: { y: clamp(round1(tile.y + step), TILE_RANGES.y) },
    }
    const patch = moves[event.key]
    if (!patch) return
    event.preventDefault()
    updateTile(key, patch)
  }

  /** Only the keys the layout API accepts — a whitelist, so stray row fields
   *  (createdAt/updatedAt on server-seeded tiles) never reach the wire. */
  function layoutPayload(tile: Keyed): EditorTile {
    return {
      ...(tile.id !== undefined ? { id: tile.id } : {}),
      kind: tile.kind,
      imageKeys: tile.imageKeys,
      textContent: tile.textContent,
      cite: tile.cite,
      x: tile.x,
      y: tile.y,
      width: tile.width,
      height: tile.height,
      rotation: tile.rotation,
      border: tile.border,
      hoverEffect: tile.hoverEffect,
      zIndex: tile.zIndex,
      cycleIntervalMs: tile.cycleIntervalMs,
    }
  }

  async function save(): Promise<void> {
    if (busy) return
    setStatus('Saving…')
    try {
      const payload = tiles.map(layoutPayload)
      const response = await fetch('/api/home/tiles', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tiles: payload }),
      })
      if (!response.ok) {
        setStatus('Save failed')
        return
      }
      // Adopt the server's canvas (ids assigned to inserts) — clean again.
      const { tiles: saved } = (await response.json()) as {
        tiles: EditorTile[]
      }
      setTiles(withKeys(saved))
      setSelectedKey(null)
      setDirty(false)
      setStatus('Saved')
    } catch {
      setStatus('Save failed')
    }
  }

  function tileLabel(tile: Keyed): string {
    const what =
      tile.kind === 'photo'
        ? (tile.imageKeys[0] ?? 'no image')
        : (tile.textContent ?? 'empty')
    return `${tile.kind} tile — ${what}`
  }

  function tileStyle(tile: Keyed): React.CSSProperties {
    return {
      left: `${tile.x}%`,
      top: `${tile.y}%`,
      width: `${tile.width}%`,
      height: `${tile.height}%`,
      zIndex: tile.zIndex,
      ['--tilt' as string]: `${tile.rotation}deg`,
      ...(tile.border
        ? { border: `${tile.border.width}px solid ${tile.border.color}` }
        : {}),
    }
  }

  return (
    <div className="canvas-editor">
      <div
        className="ed-canvas"
        ref={canvasRef}
        style={{ aspectRatio: CANVAS_ASPECT_CSS }}
      >
        {tiles.map((tile) => (
          // biome-ignore lint/a11y/useSemanticElements: the tile hosts the nested rotate/resize handle buttons — interactive content is invalid inside a real <button>.
          <div
            key={tile.clientKey}
            role="button"
            tabIndex={0}
            aria-label={tileLabel(tile)}
            aria-pressed={tile.clientKey === selectedKey}
            className={`ed-tile ed-tile--${tile.kind}${
              tile.clientKey === selectedKey ? ' is-selected' : ''
            }`}
            style={tileStyle(tile)}
            onPointerDown={(event) => beginDrag(event, tile.clientKey, 'move')}
            onPointerMove={onDragMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={(event) => nudge(event, tile.clientKey)}
          >
            {tile.kind === 'photo' && tile.imageKeys.length > 0 ? (
              <img
                src={imageUrl(
                  tile.imageKeys[activeIndexFor(tile)] ?? tile.imageKeys[0],
                  { width: 600 },
                  envImageUrlConfig(),
                )}
                alt=""
                draggable={false}
              />
            ) : (
              <span className="ed-tile__text">{tile.textContent}</span>
            )}
            {tile.clientKey === selectedKey && (
              <>
                <button
                  type="button"
                  aria-label="Rotate tile"
                  className="ed-handle ed-handle--rotate"
                  onPointerDown={(event) =>
                    beginDrag(event, tile.clientKey, 'rotate')
                  }
                  onPointerMove={onDragMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                />
                <button
                  type="button"
                  aria-label="Resize tile"
                  className="ed-handle ed-handle--resize"
                  onPointerDown={(event) =>
                    beginDrag(event, tile.clientKey, 'resize')
                  }
                  onPointerMove={onDragMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                />
              </>
            )}
          </div>
        ))}
      </div>

      <aside className="ed-side">
        <div className="ed-actions">
          <div className="ed-add-photo">
            Add photo
            <CoverUpload
              onUploaded={addPhotoTile}
              onUploadingChange={setUploading}
              disabled={status === 'Saving…'}
            />
          </div>
          <button type="button" onClick={addQuoteTile} disabled={busy}>
            Add quote
          </button>
          <button type="button" onClick={() => void save()} disabled={busy}>
            Save layout
          </button>
          <span aria-live="polite">{status}</span>
        </div>

        {selected ? (
          <TileInspector
            tile={selected}
            activeImageIndex={activeIndexFor(selected)}
            onChange={(patch) => updateTile(selected.clientKey, patch)}
            onDelete={() => removeTile(selected.clientKey)}
            onImageView={(direction) =>
              viewImage(selected.clientKey, direction === 'prev' ? -1 : 1)
            }
            onImageMove={(direction) =>
              moveActiveImage(selected.clientKey, direction === 'prev' ? -1 : 1)
            }
            onImageAdd={(imageKey) => addImage(selected.clientKey, imageKey)}
            onImageDelete={() => deleteActiveImage(selected.clientKey)}
            onUploadingChange={setUploading}
            busy={busy}
          />
        ) : (
          <p className="ed-hint">Select a tile to edit it.</p>
        )}
      </aside>
    </div>
  )
}
