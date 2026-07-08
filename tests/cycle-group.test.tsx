// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CycleGroup } from '../src/components/public/CycleGroup'

/**
 * The one public island: crossfade layer cycling (DESIGN "Cycling") under
 * fake timers, the prefers-reduced-motion guard, and interval cleanup.
 * The 1.6s fade itself is CSS (public-home.css) — here we assert which
 * layer carries `is-visible`.
 */

const IMAGES = ['/img/a.webp', '/img/b.webp', '/img/c.webp']

let reducedMotion = false

function visibleSrcs(container: HTMLElement): string[] {
  return [...container.querySelectorAll('img.is-visible')].map(
    (img) => (img as HTMLImageElement).getAttribute('src') ?? '',
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  reducedMotion = false
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion') && reducedMotion,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  )
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('CycleGroup', () => {
  it('renders every layer with only the first visible before any tick', () => {
    const { container } = render(<CycleGroup images={IMAGES} />)
    expect(container.querySelectorAll('img')).toHaveLength(3)
    expect(visibleSrcs(container)).toEqual(['/img/a.webp'])
  })

  it('advances one layer per interval, wrapping around', () => {
    const { container } = render(
      <CycleGroup images={IMAGES} intervalMs={5000} />,
    )
    act(() => vi.advanceTimersByTime(5000))
    expect(visibleSrcs(container)).toEqual(['/img/b.webp'])
    act(() => vi.advanceTimersByTime(5000))
    expect(visibleSrcs(container)).toEqual(['/img/c.webp'])
    act(() => vi.advanceTimersByTime(5000))
    expect(visibleSrcs(container)).toEqual(['/img/a.webp'])
  })

  it('never starts the timer under prefers-reduced-motion', () => {
    reducedMotion = true
    const { container } = render(
      <CycleGroup images={IMAGES} intervalMs={5000} />,
    )
    act(() => vi.advanceTimersByTime(60_000))
    expect(visibleSrcs(container)).toEqual(['/img/a.webp'])
  })

  it('never starts the timer with fewer than two images', () => {
    const { container } = render(
      <CycleGroup images={['/img/a.webp']} intervalMs={5000} />,
    )
    act(() => vi.advanceTimersByTime(60_000))
    expect(visibleSrcs(container)).toEqual(['/img/a.webp'])
  })

  it('clears its interval on unmount', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearInterval')
    const { unmount } = render(<CycleGroup images={IMAGES} />)
    unmount()
    expect(clearSpy).toHaveBeenCalled()
  })

  it('keeps distinct layers when two slots share the same image src', () => {
    const { container } = render(
      <CycleGroup images={['/img/a.webp', '/img/a.webp']} intervalMs={5000} />,
    )
    expect(container.querySelectorAll('img')).toHaveLength(2)
    act(() => vi.advanceTimersByTime(5000))
    // The second slot is now the visible one — same src, different layer.
    const layers = [...container.querySelectorAll('img')]
    expect(layers[0]?.classList.contains('is-visible')).toBe(false)
    expect(layers[1]?.classList.contains('is-visible')).toBe(true)
  })
})
