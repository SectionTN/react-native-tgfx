'use client'

import { useEffect, useRef } from 'react'

type Variant = 'dim' | 'lit'

const PALETTE: Record<Variant, { body: string; limb: string; glint: string; silk: string }> = {
  dim: { body: '#2a313d', limb: '#232a36', glint: '#2a313d', silk: 'rgba(35,42,54,0.9)' },
  lit: { body: '#e6eaf2', limb: '#d98a4a', glint: '#6aa9ff', silk: 'rgba(106,169,255,0.5)' },
}

function paint(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, variant: Variant) {
  const c = PALETTE[variant]
  const cx = w / 2
  const cy = h * 0.52
  const unit = Math.min(w, h)

  ctx.clearRect(0, 0, w, h)

  ctx.strokeStyle = c.silk
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(cx, 0)
  ctx.lineTo(cx + Math.sin(t * 0.0009) * unit * 0.01, cy - unit * 0.1)
  ctx.stroke()

  ctx.strokeStyle = c.limb
  ctx.lineCap = 'round'
  for (let side = 0; side < 2; side++) {
    const dir = side === 0 ? -1 : 1
    for (let i = 0; i < 4; i++) {
      const p = i / 3
      const breathe = Math.sin(t * 0.0016 + i * 0.7 + side * 1.4)
      const spread = unit * (0.2 + p * 0.16)
      const lift = unit * (0.055 + breathe * 0.022)
      const rootY = cy - unit * 0.045 + p * unit * 0.055

      ctx.lineWidth = unit * (0.011 - p * 0.002)
      ctx.beginPath()
      ctx.moveTo(cx + dir * unit * 0.045, rootY)
      ctx.bezierCurveTo(
        cx + dir * spread * 0.6,
        rootY - lift,
        cx + dir * spread,
        rootY - lift * 0.35,
        cx + dir * (spread + unit * 0.1),
        rootY + unit * (0.1 + p * 0.05)
      )
      ctx.stroke()
    }
  }

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

export function Spider({ variant, className }: { variant: Variant; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    let raf = 0
    let stopped = false
    let box = { width: 0, height: 0 }

    // Absolutely positioned, so it has no box until layout runs; observe instead
    // of measuring eagerly or the canvas is sized 1px wide.
    const size = () => {
      const rect = canvas.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) return
      box = rect
      canvas.width = Math.round(rect.width * dpr)
      canvas.height = Math.round(rect.height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (reduced) paint(ctx, box.width, box.height, 0, variant)
    }
    const observer = new ResizeObserver(size)
    observer.observe(canvas)
    size()

    if (!reduced) {
      const loop = (now: number) => {
        if (stopped) return
        if (box.width > 0) paint(ctx, box.width, box.height, now, variant)
        raf = requestAnimationFrame(loop)
      }
      raf = requestAnimationFrame(loop)
    }

    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [variant])

  return <canvas ref={ref} className={className} aria-hidden="true" />
}
