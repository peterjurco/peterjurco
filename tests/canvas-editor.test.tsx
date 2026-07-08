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
  imageKey: 'home/red.webp',
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
  cycleGroup: null,
}

const QUOTE: EditorTile = {
  id: 2,
  kind: 'quote',
  imageKey: null,
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
  cycleGroup: null,
}

/** PUT echo: the server returns the saved canvas, ids assigned to inserts. */
const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
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

async function saveAndReadBody(): Promise<{
  url: string
  method: string | undefined
  tiles: Array<Record<string, unknown>>
}> {
  fireEvent.click(screen.getByRole('button', { name: 'Save layout' }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  const [url, init] = fetchMock.mock.calls[0] as unknown as [
    string,
    RequestInit,
  ]
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

  it('edits the hover effect, z-index and cycle group', () => {
    renderEditor()
    selectTile(photoTile())
    fireEvent.change(screen.getByLabelText('Hover effect'), {
      target: { value: 'none' },
    })
    fireEvent.change(inspectorInput('Z-index'), { target: { value: '7' } })
    fireEvent.change(inspectorInput('Cycle group'), {
      target: { value: 'north' },
    })
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

describe('CanvasEditor — add and save', () => {
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
