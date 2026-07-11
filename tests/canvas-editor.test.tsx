// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditorTile } from '../src/components/admin/CanvasEditor'
import { CanvasEditor } from '../src/components/admin/CanvasEditor'
import { DEFAULT_CYCLE_INTERVAL_MS } from '../src/lib/home/canvas'

/**
 * Canvas-editor interactions under jsdom: pointer drags mutate the layout
 * model, the inspector edits all five REQUIREMENTS properties (size,
 * position, rotation, border, hover effect), and Save PUTs the complete
 * canvas. Geometry: the canvas rect is mocked to 1000×1400 px (the 5:7
 * CANVAS_ASPECT), so 100 px of pointer travel = 10% x, 140 px = 10% y.
 */

const PHOTO: EditorTile = {
  id: 1,
  kind: 'photo',
  imageKeys: ['home/red.webp'],
  textContent: null,
  cite: null,
  x: 10,
  y: 10,
  width: 30,
  height: 20,
  rotation: 0,
  border: null,
  hoverEffect: 'develop',
  zIndex: 1,
  cycleIntervalMs: null,
}

/** A photo tile that already carries three images, for carousel tests. */
const MULTI_PHOTO: EditorTile = {
  id: 3,
  kind: 'photo',
  imageKeys: ['home/a.webp', 'home/b.webp', 'home/c.webp'],
  textContent: null,
  cite: null,
  x: 20,
  y: 20,
  width: 30,
  height: 20,
  rotation: 0,
  border: null,
  hoverEffect: 'develop',
  zIndex: 3,
  cycleIntervalMs: null,
}

const QUOTE: EditorTile = {
  id: 2,
  kind: 'quote',
  imageKeys: [],
  textContent: 'Everything has led to this',
  cite: '— somewhere north',
  x: 50,
  y: 40,
  width: 25,
  height: 12,
  rotation: -1.6,
  border: null,
  hoverEffect: null,
  zIndex: 2,
  cycleIntervalMs: null,
}

/**
 * PUT echoes the saved canvas (ids assigned to inserts); the media presign
 * round-trip (POST /api/media/presign → PUT the presigned URL) backs the
 * inspector's "Add image" upload — each presign call returns a fresh key so
 * multi-upload tests can assert on distinct images.
 */
let uploadCount = 0
const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
  const href = String(url)
  if (href === '/api/media/presign') {
    uploadCount += 1
    return new Response(
      JSON.stringify({
        url: '/upload-url',
        key: `home/uploaded-${uploadCount}.webp`,
      }),
      { status: 200 },
    )
  }
  if (href === '/upload-url') {
    return new Response(null, { status: 200 })
  }
  const body = JSON.parse(String(init?.body)) as { tiles: EditorTile[] }
  return new Response(
    JSON.stringify({
      tiles: body.tiles.map((tile, index) => ({
        ...tile,
        id: tile.id ?? 100 + index,
      })),
    }),
    { status: 200 },
  )
})

beforeEach(() => {
  fetchMock.mockClear()
  uploadCount = 0
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 1000,
    height: 1400,
    left: 0,
    top: 0,
    right: 1000,
    bottom: 1400,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function renderEditor(tiles: EditorTile[] = [PHOTO, QUOTE]) {
  return render(<CanvasEditor initialTiles={tiles} />)
}

function photoTile(): HTMLElement {
  return screen.getByRole('button', { name: /photo tile.*home\/red\.webp/i })
}

function multiPhotoTile(): HTMLElement {
  return screen.getByRole('button', { name: /photo tile.*home\/a\.webp/i })
}

function quoteTile(): HTMLElement {
  return screen.getByRole('button', { name: /quote tile.*Everything/i })
}

function selectTile(tile: HTMLElement): void {
  fireEvent.pointerDown(tile, { pointerId: 1, clientX: 0, clientY: 0 })
  fireEvent.pointerUp(tile, { pointerId: 1 })
}

function inspectorInput(label: string): HTMLInputElement {
  return screen.getByLabelText(label) as HTMLInputElement
}

/**
 * Two CoverUpload instances can be on screen at once (the sidebar's "Add
 * photo" and, once a photo tile is selected, the inspector's "Add image") —
 * both render an input aria-labelled "Cover image", so disambiguate by
 * scoping to the inspector's own upload control.
 */
function imageUploadInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(
    '.tile-inspector .ed-add-image input[type="file"]',
  )
  if (!input) throw new Error('Inspector image-upload input not found')
  return input
}

function pngFile(name: string): File {
  return new File(['x'], name, { type: 'image/png' })
}

/**
 * Clicks Save and reads back the /api/home/tiles PUT body — located by URL
 * rather than call index, since a prior image upload in the same test also
 * goes through the shared fetch mock (presign + presigned PUT).
 */
async function saveAndReadBody(): Promise<{
  url: string
  method: string | undefined
  tiles: Array<Record<string, unknown>>
}> {
  const callsBefore = fetchMock.mock.calls.length
  fireEvent.click(screen.getByRole('button', { name: 'Save layout' }))
  await waitFor(() =>
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore),
  )
  const call = fetchMock.mock.calls
    .slice(callsBefore)
    .find(([url]) => String(url) === '/api/home/tiles')
  if (!call) throw new Error('Save PUT to /api/home/tiles not observed')
  const [url, init] = call as unknown as [string, RequestInit]
  const body = JSON.parse(String(init.body)) as {
    tiles: Array<Record<string, unknown>>
  }
  return { url, method: init.method, tiles: body.tiles }
}

describe('CanvasEditor — rendering and selection', () => {
  it('renders the seeded tiles positioned in canvas percentages', () => {
    renderEditor()
    const tile = photoTile()
    expect(tile.style.left).toBe('10%')
    expect(tile.style.top).toBe('10%')
    expect(tile.style.width).toBe('30%')
    expect(tile.style.height).toBe('20%')
  })

  it('selecting a tile opens the inspector with its values', () => {
    renderEditor()
    selectTile(photoTile())
    expect(inspectorInput('X (%)').value).toBe('10')
    expect(inspectorInput('Y (%)').value).toBe('10')
    expect(inspectorInput('Width (%)').value).toBe('30')
    expect(inspectorInput('Height (%)').value).toBe('20')
  })
})

describe('CanvasEditor — pointer interactions', () => {
  it('dragging a tile updates its x/y in the model', () => {
    renderEditor()
    const tile = photoTile()
    fireEvent.pointerDown(tile, { pointerId: 1, clientX: 300, clientY: 300 })
    fireEvent.pointerMove(tile, { pointerId: 1, clientX: 400, clientY: 440 })
    fireEvent.pointerUp(tile, { pointerId: 1 })

    expect(tile.style.left).toBe('20%') // +100 px of 1000 = +10%
    expect(tile.style.top).toBe('20%') // +140 px of 1400 = +10%
    expect(inspectorInput('X (%)').value).toBe('20')
    expect(inspectorInput('Y (%)').value).toBe('20')
  })

  it('dragging the resize handle updates width/height', () => {
    renderEditor()
    selectTile(photoTile())
    const handle = screen.getByRole('button', { name: 'Resize tile' })
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 100, clientY: 140 })
    fireEvent.pointerUp(handle, { pointerId: 1 })

    expect(inspectorInput('Width (%)').value).toBe('40')
    expect(inspectorInput('Height (%)').value).toBe('30')
    expect(photoTile().style.width).toBe('40%')
  })

  it('dragging the rotation handle rotates around the tile center', () => {
    renderEditor()
    selectTile(quoteTile())
    const handle = screen.getByRole('button', { name: 'Rotate tile' })
    // Quote center: (50 + 25/2)% of 1000 = 625 px; (40 + 12/2)% of 1400 = 644 px.
    // Pointer at -120° from the center → -120 + 90 = -30°.
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 625, clientY: 444 })
    fireEvent.pointerMove(handle, {
      pointerId: 1,
      clientX: 525,
      clientY: 470.8,
    })
    fireEvent.pointerUp(handle, { pointerId: 1 })

    expect(inspectorInput('Rotation (deg)').value).toBe('-30')
  })

  it('arrow keys nudge the selected tile (0.5%, 2% with shift)', () => {
    renderEditor()
    const tile = photoTile()
    selectTile(tile)
    fireEvent.keyDown(tile, { key: 'ArrowRight' })
    expect(tile.style.left).toBe('10.5%')
    fireEvent.keyDown(tile, { key: 'ArrowDown', shiftKey: true })
    expect(tile.style.top).toBe('12%')
    fireEvent.keyDown(tile, { key: 'ArrowLeft' })
    expect(tile.style.left).toBe('10%')
    fireEvent.keyDown(tile, { key: 'ArrowUp' })
    expect(tile.style.top).toBe('11.5%')
  })
})

describe('TileInspector — the five per-block properties', () => {
  it('edits position and size numerically', () => {
    renderEditor()
    selectTile(photoTile())
    fireEvent.change(inspectorInput('X (%)'), { target: { value: '25' } })
    fireEvent.change(inspectorInput('Y (%)'), { target: { value: '5' } })
    fireEvent.change(inspectorInput('Width (%)'), { target: { value: '45' } })
    fireEvent.change(inspectorInput('Height (%)'), { target: { value: '30' } })

    const tile = photoTile()
    expect(tile.style.left).toBe('25%')
    expect(tile.style.top).toBe('5%')
    expect(tile.style.width).toBe('45%')
    expect(tile.style.height).toBe('30%')
  })

  it('edits rotation', () => {
    renderEditor()
    selectTile(quoteTile())
    fireEvent.change(inspectorInput('Rotation (deg)'), {
      target: { value: '3.5' },
    })
    expect(quoteTile().style.getPropertyValue('--tilt')).toBe('3.5deg')
  })

  it('edits the border (width 0 clears it)', () => {
    renderEditor()
    selectTile(photoTile())
    fireEvent.change(inspectorInput('Border width (px)'), {
      target: { value: '4' },
    })
    fireEvent.change(inspectorInput('Border color'), {
      target: { value: '#f0e7d3' },
    })
    expect(photoTile().style.border).toContain('4px solid')

    fireEvent.change(inspectorInput('Border width (px)'), {
      target: { value: '0' },
    })
    expect(photoTile().style.border).toBe('')
  })

  it('edits the hover effect and z-index', () => {
    renderEditor()
    selectTile(photoTile())
    fireEvent.change(screen.getByLabelText('Hover effect'), {
      target: { value: 'none' },
    })
    fireEvent.change(inspectorInput('Z-index'), { target: { value: '7' } })
    expect(photoTile().style.zIndex).toBe('7')
  })

  it('edits quote text and cite', () => {
    renderEditor()
    selectTile(quoteTile())
    fireEvent.change(screen.getByLabelText('Quote text'), {
      target: { value: 'New words' },
    })
    fireEvent.change(inspectorInput('Cite'), { target: { value: '— new' } })
    expect(
      screen.getByRole('button', { name: /quote tile.*New words/i }),
    ).toBeTruthy()
  })

  it('deletes the selected tile', () => {
    renderEditor()
    selectTile(quoteTile())
    fireEvent.click(screen.getByRole('button', { name: 'Delete tile' }))
    expect(screen.queryByRole('button', { name: /quote tile/i })).toBeNull()
  })
})

describe('TileInspector — photo image carousel', () => {
  it('shows the active image and count; View previous disabled at the first image', () => {
    renderEditor([MULTI_PHOTO])
    selectTile(multiPhotoTile())
    expect(screen.getByText('Image 1 of 3')).toBeTruthy()
    expect(
      (
        screen.getByRole('button', {
          name: 'View previous image',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
    expect(
      (
        screen.getByRole('button', {
          name: 'View next image',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false)
  })

  it('View next/View previous browse every image WITHOUT touching imageKeys order', async () => {
    renderEditor([MULTI_PHOTO])
    selectTile(multiPhotoTile())
    const viewNext = screen.getByRole('button', { name: 'View next image' })
    const viewPrev = screen.getByRole('button', {
      name: 'View previous image',
    })
    const preview = () =>
      document.querySelector<HTMLImageElement>('.ed-image-preview img')

    // a,b,c — View next just moves the viewing cursor, a,b,c stays put.
    fireEvent.click(viewNext)
    expect(screen.getByText('Image 2 of 3')).toBeTruthy()
    expect(preview()?.src).toContain('home/b.webp')

    fireEvent.click(viewNext)
    expect(screen.getByText('Image 3 of 3')).toBeTruthy()
    expect(preview()?.src).toContain('home/c.webp')
    expect((viewNext as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(viewPrev)
    expect(screen.getByText('Image 2 of 3')).toBeTruthy()
    expect(preview()?.src).toContain('home/b.webp')
    expect((viewPrev as HTMLButtonElement).disabled).toBe(false)

    // Pure navigation — the saved order must be exactly the seeded order
    // (saving deselects the tile, so this must be the last step).
    const { tiles } = await saveAndReadBody()
    const saved = tiles.find((entry) => entry.id === MULTI_PHOTO.id)
    expect(saved?.imageKeys).toEqual([
      'home/a.webp',
      'home/b.webp',
      'home/c.webp',
    ])
  })

  it('Move right walks the viewed image toward the end, reordering imageKeys as it goes', async () => {
    renderEditor([MULTI_PHOTO])
    selectTile(multiPhotoTile())
    const moveRight = screen.getByRole('button', {
      name: 'Move image right',
    })

    // a,b,c — viewing a (slot 0) — Move right → swap(0,1) → b,a,c, viewing a at slot 1.
    fireEvent.click(moveRight)
    expect(screen.getByText('Image 2 of 3')).toBeTruthy()
    // b,a,c — Move right → swap(1,2) → b,c,a, viewing a at slot 2 (the last).
    fireEvent.click(moveRight)
    expect(screen.getByText('Image 3 of 3')).toBeTruthy()
    expect((moveRight as HTMLButtonElement).disabled).toBe(true)

    const { tiles } = await saveAndReadBody()
    const saved = tiles.find((entry) => entry.id === MULTI_PHOTO.id)
    expect(saved?.imageKeys).toEqual([
      'home/b.webp',
      'home/c.webp',
      'home/a.webp',
    ])
  })

  it('Move left walks the viewed image back, undoing prior Move right swaps', async () => {
    renderEditor([MULTI_PHOTO])
    selectTile(multiPhotoTile())
    const moveRight = screen.getByRole('button', {
      name: 'Move image right',
    })
    const moveLeft = screen.getByRole('button', { name: 'Move image left' })

    // a,b,c → b,c,a (viewing a at slot 2) — two Move rights, per the hand
    // trace above.
    fireEvent.click(moveRight)
    fireEvent.click(moveRight)
    expect(screen.getByText('Image 3 of 3')).toBeTruthy()

    // b,c,a — Move left → swap(2,1) → b,a,c, viewing a back at slot 1.
    fireEvent.click(moveLeft)
    expect(screen.getByText('Image 2 of 3')).toBeTruthy()
    expect((moveLeft as HTMLButtonElement).disabled).toBe(false)

    const { tiles } = await saveAndReadBody()
    const saved = tiles.find((entry) => entry.id === MULTI_PHOTO.id)
    expect(saved?.imageKeys).toEqual([
      'home/b.webp',
      'home/a.webp',
      'home/c.webp',
    ])
  })

  it('Add image appends the uploaded key and makes it active', async () => {
    renderEditor([PHOTO])
    selectTile(photoTile())
    expect(screen.getByText('Image 1 of 1')).toBeTruthy()

    fireEvent.change(imageUploadInput(), {
      target: { files: [pngFile('second.png')] },
    })
    await waitFor(() => expect(screen.getByText('Image 2 of 2')).toBeTruthy())

    const { tiles } = await saveAndReadBody()
    const saved = tiles.find((entry) => entry.id === PHOTO.id)
    expect(saved?.imageKeys).toEqual(['home/red.webp', 'home/uploaded-1.webp'])
  })

  it('deletes the active image; the last remaining image cannot be deleted', async () => {
    renderEditor([MULTI_PHOTO])
    selectTile(multiPhotoTile())
    const del = screen.getByRole('button', {
      name: 'Delete image',
    }) as HTMLButtonElement
    expect(del.disabled).toBe(false)

    fireEvent.click(del) // removes 'a' (active slot 0) → b,c stay at slot 0
    expect(screen.getByText('Image 1 of 2')).toBeTruthy()
    fireEvent.click(del) // removes 'b' → only 'c' left
    expect(screen.getByText('Image 1 of 1')).toBeTruthy()
    expect(del.disabled).toBe(true)

    const { tiles } = await saveAndReadBody()
    const saved = tiles.find((entry) => entry.id === MULTI_PHOTO.id)
    expect(saved?.imageKeys).toEqual(['home/c.webp'])
  })
})

describe('TileInspector — cycle interval field', () => {
  it('is hidden for a single-image tile', () => {
    renderEditor([PHOTO])
    selectTile(photoTile())
    expect(screen.queryByLabelText('Change every (seconds)')).toBeNull()
  })

  it('shows for a multi-image tile, empty with a placeholder derived from DEFAULT_CYCLE_INTERVAL_MS', () => {
    renderEditor([MULTI_PHOTO])
    selectTile(multiPhotoTile())
    const field = inspectorInput('Change every (seconds)')
    expect(field.value).toBe('')
    // Not a hardcoded '5' — proves TileInspector derives the placeholder
    // from the shared constant instead of its own copy of the default.
    expect(field.placeholder).toBe(String(DEFAULT_CYCLE_INTERVAL_MS / 1000))
  })

  it('maps seconds to milliseconds on save', async () => {
    renderEditor([MULTI_PHOTO])
    selectTile(multiPhotoTile())
    fireEvent.change(inspectorInput('Change every (seconds)'), {
      target: { value: '3' },
    })
    expect(inspectorInput('Change every (seconds)').value).toBe('3')

    const { tiles } = await saveAndReadBody()
    const saved = tiles.find((entry) => entry.id === MULTI_PHOTO.id)
    expect(saved?.cycleIntervalMs).toBe(3000)
  })

  it('clamps out-of-range seconds to the 500–60000ms bounds', () => {
    renderEditor([MULTI_PHOTO])
    selectTile(multiPhotoTile())
    const field = inspectorInput('Change every (seconds)')
    fireEvent.change(field, { target: { value: '0.1' } }) // 100ms < 500ms min
    expect(field.value).toBe('0.5')
    fireEvent.change(field, { target: { value: '120' } }) // 120000ms > 60000ms max
    expect(field.value).toBe('60')
  })
})

describe('CanvasEditor — add and save', () => {
  it('adding a photo via upload creates a tile with one imageKey and no interval', async () => {
    renderEditor([])
    const input = document.querySelector<HTMLInputElement>(
      '.ed-add-photo input[type="file"]',
    )
    if (!input) throw new Error('Add-photo input not found')
    fireEvent.change(input, { target: { files: [pngFile('first.png')] } })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /photo tile/i })).toBeTruthy(),
    )

    const { tiles } = await saveAndReadBody()
    expect(tiles).toHaveLength(1)
    expect(tiles[0]).toMatchObject({
      kind: 'photo',
      imageKeys: ['home/uploaded-1.webp'],
      cycleIntervalMs: null,
    })
  })

  it('adds a quote tile on top of the stack', () => {
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Add quote' }))
    const added = screen.getAllByRole('button', { name: /quote tile/i })
    expect(added.length).toBe(2)
  })

  it('Save PUTs the complete canvas with every edited property', async () => {
    renderEditor()
    // Move the photo, restyle it, add a quote — then save.
    const tile = photoTile()
    fireEvent.pointerDown(tile, { pointerId: 1, clientX: 300, clientY: 300 })
    fireEvent.pointerMove(tile, { pointerId: 1, clientX: 400, clientY: 440 })
    fireEvent.pointerUp(tile, { pointerId: 1 })
    fireEvent.change(inspectorInput('Border width (px)'), {
      target: { value: '2' },
    })
    fireEvent.change(screen.getByLabelText('Hover effect'), {
      target: { value: 'none' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add quote' }))

    const { url, method, tiles } = await saveAndReadBody()
    expect(url).toBe('/api/home/tiles')
    expect(method).toBe('PUT')
    expect(tiles).toHaveLength(3)

    const photo = tiles.find((entry) => entry.id === 1)
    expect(photo).toMatchObject({
      kind: 'photo',
      x: 20,
      y: 20,
      hoverEffect: 'none',
      border: { width: 2, color: '#f0e7d3' },
    })
    expect(tiles.find((entry) => entry.id === 2)).toBeTruthy()
    const inserted = tiles.find((entry) => entry.id === undefined)
    expect(inserted).toMatchObject({ kind: 'quote' })

    // The echoed save syncs ids — the editor is clean again.
    await waitFor(() => expect(screen.getByText('Saved')).toBeTruthy())
  })

  it('guards against double submit while a save is in flight', async () => {
    let release: (response: Response) => void = () => {}
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve
        }),
    )
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Add quote' }))
    const save = screen.getByRole('button', { name: 'Save layout' })
    fireEvent.click(save)
    fireEvent.click(save) // ignored — busy
    expect(fetchMock).toHaveBeenCalledTimes(1)
    release(new Response(JSON.stringify({ tiles: [] }), { status: 200 }))
    await waitFor(() => expect(screen.getByText('Saved')).toBeTruthy())
  })

  it('shows Save failed and stays dirty when the PUT fails', async () => {
    fetchMock.mockImplementationOnce(
      async () => new Response('{}', { status: 500 }),
    )
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Add quote' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save layout' }))
    await waitFor(() => expect(screen.getByText('Save failed')).toBeTruthy())
  })

  it('warns about unsaved changes via beforeunload only while dirty', () => {
    renderEditor()
    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Add quote' }))
    const dirty = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)
  })
})

describe('TileInspector — numeric input edge cases', () => {
  it('clearing a field commits nothing (no collapse to 0)', () => {
    renderEditor()
    selectTile(photoTile())
    const width = inspectorInput('Width (%)')
    fireEvent.change(width, { target: { value: '' } })
    // Model untouched: the tile keeps its 30% width.
    expect(photoTile().style.width).toBe('30%')
  })

  it('typing a negative value works for X (leading "-" is not swallowed)', () => {
    renderEditor()
    selectTile(photoTile())
    const x = inspectorInput('X (%)')
    // The intermediate lone "-" parses to NaN → ignored, input keeps focus…
    fireEvent.change(x, { target: { value: '-' } })
    expect(photoTile().style.left).toBe('10%')
    // …and the completed negative number commits.
    fireEvent.change(x, { target: { value: '-5' } })
    expect(photoTile().style.left).toBe('-5%')
  })

  it('hides the hover-effect control for quote tiles (renderer ignores it)', () => {
    renderEditor()
    selectTile(quoteTile())
    expect(screen.queryByLabelText('Hover effect')).toBeNull()
  })
})
