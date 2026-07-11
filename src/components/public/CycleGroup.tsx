import { useEffect, useState } from 'react'

/**
 * Slow crossfade among a tile's own images (DESIGN "Cycling"): every
 * ~5s (or `intervalMs`) the next image fades in over ~1.6s (the opacity
 * transition lives in public-home.css `.cycle-layer`). Subtle — explicitly
 * not a flip/flash.
 *
 * This is the ONLY island the public homepage ships, mounted only for a
 * photo tile with more than one image (see TileRenderer.astro). The first
 * layer is visible in the SSR output, so the tile is correct before (or
 * without) hydration. Under `prefers-reduced-motion` the timer never
 * starts — the first photo simply stays.
 */

interface CycleGroupProps {
  /** Image srcs in stacking order; the first is the resting layer. */
  images: string[]
  intervalMs?: number
}

export function CycleGroup({ images, intervalMs = 5000 }: CycleGroupProps) {
  const [active, setActive] = useState(0)

  useEffect(() => {
    if (images.length < 2) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const timer = setInterval(() => {
      setActive((index) => (index + 1) % images.length)
    }, intervalMs)
    return () => clearInterval(timer)
  }, [images.length, intervalMs])

  return (
    <>
      {images.map((src, index) => (
        <img
          // The layer's identity is its slot, not its picture: the list is
          // static for the island's lifetime, and two members of a group may
          // share the same image src (so src alone would collide).
          // biome-ignore lint/suspicious/noArrayIndexKey: static list; slot IS the identity
          key={`${index}-${src}`}
          className={
            index === active ? 'cycle-layer is-visible' : 'cycle-layer'
          }
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
        />
      ))}
    </>
  )
}
