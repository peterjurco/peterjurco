import { HOVER_EFFECTS, TILE_RANGES } from '../../lib/home/canvas'
import { envImageUrlConfig, imageUrl } from '../../lib/media/image-url'
import { CoverUpload } from '../CoverUpload'
import type { EditorTile } from './CanvasEditor'

/**
 * Per-tile property panel — the five REQUIREMENTS "Admin edit model"
 * controls (size, position, rotation, border, hover effect) plus stacking,
 * a photo tile's image carousel (browse/reorder/add/delete + cycle interval)
 * and, for quotes, the text/cite. Numeric fields mirror the pointer gestures
 * for precise input; all edits go through onChange into the CanvasEditor
 * model and persist on Save.
 *
 * IMAGE BROWSING: `activeImageIndex` is owned by CanvasEditor (not this
 * component) so it survives reselecting a different tile and back — see
 * CanvasEditor's `activeImageIndex` state.
 */

interface TileInspectorProps {
  tile: EditorTile
  /** Which of tile.imageKeys is currently shown/acted on — clamped upstream. */
  activeImageIndex: number
  onChange: (patch: Partial<EditorTile>) => void
  onDelete: () => void
  /** Swaps the active image with its previous/next neighbor. */
  onImageReorder: (direction: 'prev' | 'next') => void
  /** Appends a freshly uploaded image and makes it active. */
  onImageAdd: (imageKey: string) => void
  /** Removes the active image (a tile must keep at least one — see the
   *  disabled ‹Delete image› below). */
  onImageDelete: () => void
  onUploadingChange: (uploading: boolean) => void
  /** Blocks starting a new image upload while a save (or another upload) is
   *  in flight. */
  busy: boolean
}

const DEFAULT_BORDER_COLOR = '#f0e7d3'
const IMAGE_PREVIEW_WIDTH = 240

/**
 * null = "no committable value yet", so the model is left untouched: a
 * cleared field must not collapse to 0 (`Number('') === 0`), and a partial
 * `-` while typing a negative number must not commit anything.
 */
function parseNumber(raw: string): number | null {
  if (raw.trim() === '') return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

const clamp = (value: number, { min, max }: { min: number; max: number }) =>
  Math.min(max, Math.max(min, value))

export function TileInspector({
  tile,
  activeImageIndex,
  onChange,
  onDelete,
  onImageReorder,
  onImageAdd,
  onImageDelete,
  onUploadingChange,
  busy,
}: TileInspectorProps) {
  function numberField(
    label: string,
    value: number,
    apply: (value: number) => Partial<EditorTile>,
    step = 0.5,
  ) {
    return (
      <label>
        {label}
        <input
          type="number"
          aria-label={label}
          step={step}
          value={value}
          onChange={(event) => {
            const parsed = parseNumber(event.target.value)
            if (parsed !== null) onChange(apply(parsed))
          }}
        />
      </label>
    )
  }

  const activeImageKey = tile.imageKeys[activeImageIndex]

  return (
    <div className="tile-inspector">
      <h2>
        {tile.kind === 'photo' ? 'Photo tile' : 'Quote tile'}
        {tile.id !== undefined ? ` #${tile.id}` : ' (new)'}
      </h2>

      <fieldset>
        <legend>Position</legend>
        {numberField('X (%)', tile.x, (x) => ({
          x: clamp(x, TILE_RANGES.x),
        }))}
        {numberField('Y (%)', tile.y, (y) => ({
          y: clamp(y, TILE_RANGES.y),
        }))}
      </fieldset>

      <fieldset>
        <legend>Size</legend>
        {numberField('Width (%)', tile.width, (width) => ({
          width: clamp(width, TILE_RANGES.width),
        }))}
        {numberField('Height (%)', tile.height, (height) => ({
          height: clamp(height, TILE_RANGES.height),
        }))}
      </fieldset>

      <fieldset>
        <legend>Rotation</legend>
        {numberField(
          'Rotation (deg)',
          tile.rotation,
          (rotation) => ({ rotation: clamp(rotation, TILE_RANGES.rotation) }),
          0.1,
        )}
        <input
          type="range"
          aria-label="Rotation slider"
          min={TILE_RANGES.rotation.min}
          max={TILE_RANGES.rotation.max}
          step={0.1}
          value={tile.rotation}
          onChange={(event) => {
            const parsed = parseNumber(event.target.value)
            if (parsed !== null) onChange({ rotation: parsed })
          }}
        />
      </fieldset>

      <fieldset>
        <legend>Border</legend>
        {numberField(
          'Border width (px)',
          tile.border?.width ?? 0,
          (width) => ({
            border:
              width > 0
                ? {
                    width,
                    color: tile.border?.color ?? DEFAULT_BORDER_COLOR,
                  }
                : null,
          }),
          1,
        )}
        <label>
          Border color
          {/* type="color" emits #rrggbb — exactly what the API's hex-only
              border.color validation (tile-fields.ts) accepts. */}
          <input
            type="color"
            aria-label="Border color"
            value={tile.border?.color ?? DEFAULT_BORDER_COLOR}
            onChange={(event) => {
              if (tile.border) {
                onChange({
                  border: { ...tile.border, color: event.target.value },
                })
              }
            }}
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>Behavior</legend>
        {/* The renderer only honors hover effects on photo tiles (quote
            hover is fixed by DESIGN) — don't offer a dead control. */}
        {tile.kind === 'photo' && (
          <label>
            Hover effect
            <select
              aria-label="Hover effect"
              value={tile.hoverEffect ?? 'develop'}
              onChange={(event) =>
                onChange({ hoverEffect: event.target.value })
              }
            >
              {HOVER_EFFECTS.map((effect) => (
                <option key={effect} value={effect}>
                  {effect}
                </option>
              ))}
            </select>
          </label>
        )}
        {numberField('Z-index', tile.zIndex, (zIndex) => ({
          zIndex: Math.round(zIndex),
        }))}
      </fieldset>

      {tile.kind === 'photo' && (
        <fieldset>
          <legend>Images</legend>
          {activeImageKey ? (
            <div className="ed-image-preview">
              <img
                src={imageUrl(
                  activeImageKey,
                  { width: IMAGE_PREVIEW_WIDTH },
                  envImageUrlConfig(),
                )}
                alt=""
              />
              <span>{`Image ${activeImageIndex + 1} of ${tile.imageKeys.length}`}</span>
            </div>
          ) : (
            <span>No image yet</span>
          )}

          <div className="ed-image-actions">
            <button
              type="button"
              aria-label="Previous image"
              onClick={() => onImageReorder('prev')}
              disabled={activeImageIndex <= 0}
            >
              ‹
            </button>
            <button
              type="button"
              aria-label="Next image"
              onClick={() => onImageReorder('next')}
              disabled={activeImageIndex >= tile.imageKeys.length - 1}
            >
              ›
            </button>
            <button
              type="button"
              onClick={onImageDelete}
              disabled={tile.imageKeys.length <= 1}
            >
              Delete image
            </button>
          </div>

          <div className="ed-add-image">
            Add image
            <CoverUpload
              onUploaded={onImageAdd}
              onUploadingChange={onUploadingChange}
              disabled={busy}
            />
          </div>

          {tile.imageKeys.length > 1 && (
            <label>
              Change every (seconds)
              <input
                type="number"
                aria-label="Change every (seconds)"
                step={0.5}
                placeholder="5"
                value={
                  tile.cycleIntervalMs !== null
                    ? tile.cycleIntervalMs / 1000
                    : ''
                }
                onChange={(event) => {
                  const parsed = parseNumber(event.target.value)
                  if (parsed === null) return
                  onChange({
                    cycleIntervalMs: clamp(
                      Math.round(parsed * 1000),
                      TILE_RANGES.cycleIntervalMs,
                    ),
                  })
                }}
              />
            </label>
          )}
        </fieldset>
      )}

      {tile.kind === 'quote' && (
        <fieldset>
          <legend>Quote</legend>
          <label>
            Quote text
            <textarea
              aria-label="Quote text"
              value={tile.textContent ?? ''}
              onChange={(event) =>
                onChange({ textContent: event.target.value })
              }
            />
          </label>
          <label>
            Cite
            <input
              type="text"
              aria-label="Cite"
              placeholder="with a cite it renders as the marquee"
              value={tile.cite ?? ''}
              onChange={(event) =>
                onChange({ cite: event.target.value || null })
              }
            />
          </label>
        </fieldset>
      )}

      <button type="button" onClick={onDelete}>
        Delete tile
      </button>
    </div>
  )
}
