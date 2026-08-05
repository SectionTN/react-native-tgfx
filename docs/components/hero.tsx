'use client'

import Link from 'next/link'
import { useEffect, useRef } from 'react'
import { Spider } from './spider'

const HEADLINE = 'Draw with React components. Animate on the thread that paints.'

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
        <p className="tg-status">alpha · 0.0.1</p>
        <h1 className="tg-hero-headline">
          {HEADLINE.split(' ').map((word, i) => (
            <span key={`${word}-${i}`} className="tg-word" style={{ animationDelay: `${i * 0.045}s` }}>
              {word}
            </span>
          ))}
        </h1>
        <p className="tg-hero-sub">
          A GPU 2D canvas for React Native, backed by Tencent&rsquo;s tgfx. Shapes,
          paths, text, images and runtime shaders &mdash; drawn by the GPU,
          animated on the thread that paints.
        </p>
        <div className="tg-hero-actions">
          <Link href="/docs" className="tg-cta">
            <span className="tg-cta-bg" />
            <span className="tg-cta-text">Read the docs</span>
            <span className="tg-cta-circle" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
                <path d="M5 13L13 5M13 5H6M13 5V12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </Link>
          <Link href="/docs/installation" className="tg-ghost">
            Install
          </Link>
        </div>
      </div>
    </section>
  )
}
