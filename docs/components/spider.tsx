'use client'

import { useEffect, useRef } from 'react'

type Variant = 'dim' | 'lit' | 'themed'
type Colors = { body: string; limb: string; glint: string; silk: string }

const PALETTE: Record<'dim' | 'lit', Colors> = {
  dim: { body: '#2a313d', limb: '#232a36', glint: '#2a313d', silk: 'rgba(35,42,54,0.9)' },
  lit: { body: '#e6eaf2', limb: '#8b5cf6', glint: '#c4b5fd', silk: 'rgba(196,181,253,0.5)' },
}

// The Margelo mark, as served inline in their own header (viewBox 0 0 15 14).
const MARK = 'M0 13.2353L0 0.827206L14.1176 12.3529L10 4.13603L15 0V13.2353H0Z'
const MARK_W = 15
const MARK_H = 14
let markPath: Path2D | undefined

// Path2D is browser-only and this module is evaluated on the server too.
function mark() {
  return (markPath ??= new Path2D(MARK))
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const ramp = (v: number, from: number, to: number) => clamp01((v - from) / (to - from))

// `themed` follows the palette variables, so it reads on either ground.
function colorsFor(variant: Variant, el: Element): Colors {
  if (variant !== 'themed') return PALETTE[variant]
  const style = getComputedStyle(el)
  const read = (name: string) => style.getPropertyValue(name).trim()
  const primary = read('--color-fd-primary')
  return { body: read('--color-fd-foreground'), limb: primary, glint: primary, silk: primary }
}

/**
 * `morph` runs 0 (spider) to 1 (Margelo mark): the legs fold in and fade, the
 * body goes with them, and the mark resolves in their place.
 */
function paint(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  c: Colors,
  morph = 0
) {
  const cx = w / 2
  const cy = h * 0.52
  const unit = Math.min(w, h)

  const fold = ramp(morph, 0.1, 0.6)
  const legAlpha = 1 - ramp(morph, 0.2, 0.6)
  const bodyAlpha = 1 - ramp(morph, 0.45, 0.85)
  const markAlpha = ramp(morph, 0.5, 1)

  ctx.clearRect(0, 0, w, h)

  if (bodyAlpha > 0) {
    ctx.globalAlpha = bodyAlpha
    ctx.strokeStyle = c.silk
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(cx, 0)
    ctx.lineTo(cx + Math.sin(t * 0.0009) * unit * 0.01, cy - unit * 0.1)
    ctx.stroke()
  }

  if (legAlpha > 0) {
    ctx.globalAlpha = legAlpha
    ctx.strokeStyle = c.limb
    ctx.lineCap = 'round'
    for (let side = 0; side < 2; side++) {
      const dir = side === 0 ? -1 : 1
      for (let i = 0; i < 4; i++) {
        const p = i / 3
        const breathe = Math.sin(t * 0.0016 + i * 0.7 + side * 1.4)
        const spread = unit * (0.2 + p * 0.16) * (1 - fold * 0.88)
        const lift = unit * (0.055 + breathe * 0.022) * (1 - fold)
        const rootY = cy - unit * 0.045 + p * unit * 0.055

        ctx.lineWidth = unit * (0.011 - p * 0.002)
        ctx.beginPath()
        ctx.moveTo(cx + dir * unit * 0.045, rootY)
        ctx.bezierCurveTo(
          cx + dir * spread * 0.6,
          rootY - lift,
          cx + dir * spread,
          rootY - lift * 0.35,
          cx + dir * (spread + unit * 0.1 * (1 - fold)),
          rootY + unit * (0.1 + p * 0.05) * (1 - fold)
        )
        ctx.stroke()
      }
    }
  }

  if (bodyAlpha > 0) {
    ctx.globalAlpha = bodyAlpha
    ctx.fillStyle = c.body
    ellipse(ctx, cx, cy + unit * 0.095, unit * 0.085, unit * 0.11)
    ellipse(ctx, cx, cy - unit * 0.05, unit * 0.055, unit * 0.05)

    ctx.fillStyle = c.glint
    for (let i = 0; i < 4; i++) {
      circle(ctx, cx + (i - 1.5) * unit * 0.021, cy - unit * 0.075, unit * 0.0075)
    }
    for (let i = 0; i < 2; i++) {
      circle(ctx, cx + (i - 0.5) * unit * 0.026, cy - unit * 0.052, unit * 0.0055)
    }
  }

  if (markAlpha > 0) {
    const scale = ((unit * 0.46) / MARK_W) * (0.72 + markAlpha * 0.28)
    ctx.globalAlpha = markAlpha
    ctx.fillStyle = c.limb
    ctx.save()
    ctx.translate(cx, cy)
    ctx.scale(scale, scale)
    ctx.translate(-MARK_W / 2, -MARK_H / 2)
    ctx.fill(mark())
    ctx.restore()
  }

  ctx.globalAlpha = 1
}

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number) {
  ctx.beginPath()
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
  ctx.fill()
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}

export function Spider({
  variant,
  className,
  morphMs,
  morphDelayMs = 0,
  morph,
}: {
  variant: Variant
  className?: string
  /** Milliseconds to spend turning the spider into the Margelo mark. */
  morphMs?: number
  /** Milliseconds to stay a spider first, so the morph can start on landing. */
  morphDelayMs?: number
  /** Fixed morph value. Paints once and runs no animation loop at all. */
  morph?: number
}) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const colors = colorsFor(variant, canvas)
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    let raf = 0
    let stopped = false
    let box = { width: 0, height: 0 }
    // A resize repaint must land on the current frame, or it snaps the morph back.
    let lastT = 0
    let lastMorph = morph ?? 0

    // Absolutely positioned, so observe instead of measuring eagerly or the canvas is 1px wide.
    const size = () => {
      const rect = canvas.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) return
      box = rect
      canvas.width = Math.round(rect.width * dpr)
      canvas.height = Math.round(rect.height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      // Paint on sizing too, or a freshly mounted canvas shows one blank frame.
      paint(ctx, box.width, box.height, lastT, colors, lastMorph)
    }
    const observer = new ResizeObserver(size)
    observer.observe(canvas)
    size()

    // A fixed morph never changes, so it costs one paint instead of a loop.
    if (!reduced && morph === undefined) {
      let started: number | undefined
      const loop = (now: number) => {
        if (stopped) return
        if (started === undefined) started = now
        lastT = now
        lastMorph = morphMs ? clamp01((now - started - morphDelayMs) / morphMs) : 0
        if (box.width > 0) paint(ctx, box.width, box.height, lastT, colors, lastMorph)
        raf = requestAnimationFrame(loop)
      }
      raf = requestAnimationFrame(loop)
    }

    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [variant, morphMs, morphDelayMs, morph])

  return <canvas ref={ref} className={className} aria-hidden="true" />
}
