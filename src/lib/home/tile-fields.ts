import { HOVER_EFFECTS, TILE_RANGES, type TileBorder } from './canvas'
import type { LayoutTile, TileValues } from './repo'

/**
 * Request-body validation for the home-tiles API — shared by create
 * (POST /api/home/tiles), patch (PATCH /api/home/tiles/:id) and the bulk
 * layout save (PUT /api/home/tiles). Follows the album-fields convention:
 * validate whatever is present, return the parsed fields or an error string
 * naming the bad field.
 */

const TEXT_MAX = 2000
const CITE_MAX = 500
const CYCLE_GROUP_MAX = 100
const BORDER_WIDTH_MAX = 100

export type TileFields = Partial<TileValues>

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function inRange(
  value: unknown,
  { min, max }: { min: number; max: number },
): value is number {
  return isFiniteNumber(value) && value >= min && value <= max
}

/** Validates any tile fields present on a request body. */
export function parseTileFields(
  body: Record<string, unknown>,
): TileFields | string {
  const fields: TileFields = {}

  if ('kind' in body) {
    if (body.kind !== 'photo' && body.kind !== 'quote') {
      return "kind must be 'photo' or 'quote'"
    }
    fields.kind = body.kind
  }
  if ('imageKey' in body) {
    if (
      body.imageKey !== null &&
      (typeof body.imageKey !== 'string' || body.imageKey.length === 0)
    ) {
      return 'imageKey must be a non-empty string or null'
    }
    fields.imageKey = body.imageKey as string | null
  }
  if ('textContent' in body) {
    if (
      body.textContent !== null &&
      (typeof body.textContent !== 'string' ||
        body.textContent.length > TEXT_MAX)
    ) {
      return `textContent must be a string of at most ${TEXT_MAX} characters, or null`
    }
    fields.textContent = body.textContent as string | null
  }
  if ('cite' in body) {
    if (
      body.cite !== null &&
      (typeof body.cite !== 'string' || body.cite.length > CITE_MAX)
    ) {
      return `cite must be a string of at most ${CITE_MAX} characters, or null`
    }
    fields.cite = body.cite as string | null
  }

  // Layout numbers — ranges shared with the editor (src/lib/home/canvas.ts).
  for (const axis of ['x', 'y', 'width', 'height', 'rotation'] as const) {
    if (axis in body) {
      const range = TILE_RANGES[axis]
      if (!inRange(body[axis], range)) {
        return `${axis} must be a number between ${range.min} and ${range.max}`
      }
      fields[axis] = body[axis] as number
    }
  }
  if ('zIndex' in body) {
    if (!isFiniteNumber(body.zIndex) || !Number.isInteger(body.zIndex)) {
      return 'zIndex must be an integer'
    }
    fields.zIndex = body.zIndex
  }

  if ('hoverEffect' in body) {
    if (
      body.hoverEffect !== null &&
      !HOVER_EFFECTS.includes(body.hoverEffect as never)
    ) {
      return `hoverEffect must be one of ${HOVER_EFFECTS.join(', ')} or null`
    }
    fields.hoverEffect = body.hoverEffect as string | null
  }
  if ('border' in body) {
    if (body.border !== null) {
      const border = body.border as Partial<TileBorder> | undefined
      if (
        typeof body.border !== 'object' ||
        !inRange(border?.width, { min: 0, max: BORDER_WIDTH_MAX }) ||
        typeof border?.color !== 'string' ||
        border.color.length === 0
      ) {
        return 'border must be { width: number, color: string } or null'
      }
    }
    fields.border = body.border as TileBorder | null
  }
  if ('cycleGroup' in body) {
    if (
      body.cycleGroup !== null &&
      (typeof body.cycleGroup !== 'string' ||
        body.cycleGroup.length === 0 ||
        body.cycleGroup.length > CYCLE_GROUP_MAX)
    ) {
      return `cycleGroup must be a non-empty string of at most ${CYCLE_GROUP_MAX} characters, or null`
    }
    fields.cycleGroup = body.cycleGroup as string | null
  }

  return fields
}

/**
 * Promotes parsed fields to a complete tile (create/bulk entries): the kind,
 * the full layout box and stacking order are required, and the kind's content
 * field must be present — a photo without an imageKey (or a quote without
 * textContent) can never render.
 */
export function requireCompleteTile(fields: TileFields): TileValues | string {
  const { kind, x, y, width, height, zIndex } = fields
  if (kind === undefined) return 'kind is required'
  if (
    x === undefined ||
    y === undefined ||
    width === undefined ||
    height === undefined
  ) {
    return 'x, y, width and height are required'
  }
  if (zIndex === undefined) return 'zIndex is required'
  if (kind === 'photo' && !fields.imageKey) {
    return 'photo tiles require an imageKey'
  }
  if (kind === 'quote' && !fields.textContent) {
    return 'quote tiles require textContent'
  }
  return { ...fields, kind, x, y, width, height, zIndex }
}

/**
 * Parses the PUT bulk-save body `{ tiles: [...] }` — the complete canvas.
 * Entries may carry a positive-integer `id` (existing rows); id-less entries
 * are inserts. Errors name the offending index (`tiles[i]: …`).
 */
export function parseLayoutPayload(body: unknown): LayoutTile[] | string {
  if (typeof body !== 'object' || body === null) {
    return 'Body must be a JSON object'
  }
  const { tiles } = body as { tiles?: unknown }
  if (!Array.isArray(tiles)) return 'tiles must be an array'

  const layout: LayoutTile[] = []
  for (const [index, entry] of tiles.entries()) {
    if (typeof entry !== 'object' || entry === null) {
      return `tiles[${index}]: must be an object`
    }
    const { id, ...rest } = entry as Record<string, unknown>
    if (
      id !== undefined &&
      (!isFiniteNumber(id) || !Number.isInteger(id) || id <= 0)
    ) {
      return `tiles[${index}]: id must be a positive integer`
    }
    const fields = parseTileFields(rest)
    if (typeof fields === 'string') return `tiles[${index}]: ${fields}`
    const complete = requireCompleteTile(fields)
    if (typeof complete === 'string') return `tiles[${index}]: ${complete}`
    layout.push(id === undefined ? complete : { ...complete, id: id as number })
  }
  return layout
}
