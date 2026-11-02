'use client'

import Link from 'next/link'
import { useEffect, useRef } from 'react'
import { Spider } from './spider'

function useSpotlight() {
  const layer = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = layer.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.style.maskImage = 'none'
      el.style.webkitMaskImage = 'none'
      return
    }

    const pointer = { x: -999, y: -999 }
    const eased = { x: -999, y: -999 }
    let raf = 0

    const onMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect()
      pointer.x = e.clientX - rect.left
      pointer.y = e.clientY - rect.top
    }
    const onLeave = () => {
      pointer.x = -999
      pointer.y = -999
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerleave', onLeave)

    const loop = () => {
      eased.x += (pointer.x - eased.x) * 0.12
      eased.y += (pointer.y - eased.y) * 0.12
      const g = `radial-gradient(circle 240px at ${eased.x}px ${eased.y}px, #000 0%, #000 42%, rgba(0,0,0,0.55) 64%, rgba(0,0,0,0.12) 84%, transparent 100%)`
      el.style.maskImage = g
      el.style.webkitMaskImage = g
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerleave', onLeave)
    }
  }, [])

  return layer
}

export function Hero() {
  const layer = useSpotlight()

  return (
    <section className="tg-hero">
      <div className="tg-hero-word" aria-hidden="true">
        <h2>tgfx</h2>
      </div>

      <div className="tg-hero-stage">
        <Spider variant="dim" className="tg-hero-canvas" />
        <div ref={layer} className="tg-hero-lit">
          <Spider variant="lit" className="tg-hero-canvas" />
        </div>
      </div>

      <div className="tg-hero-content">
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/docs"
            className="rounded-full bg-fd-primary px-5 py-2.5 text-sm font-medium text-fd-primary-foreground transition-opacity hover:opacity-90"
          >
            Get Started
          </Link>
          <Link
            href="/api"
            className="rounded-full border bg-fd-secondary px-5 py-2.5 text-sm font-medium text-fd-secondary-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground"
          >
            API Reference
          </Link>
        </div>
      </div>
    </section>
  )
}
