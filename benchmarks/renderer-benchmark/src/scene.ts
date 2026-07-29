/* eslint-disable no-bitwise */
import type { FrameStats, Shape } from './types'

const palette = [
  ['#ff5d73', '#7f1d3a'],
  ['#40c9a2', '#065f46'],
  ['#5b8def', '#1e3a8a'],
  ['#f6c85f', '#92400e'],
  ['#a78bfa', '#5b21b6'],
] as const

function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

export function buildScene(
  count: number,
  seed: number,
  width: number,
  height: number,
  phase: number
): Shape[] {
  const random = seeded(seed)
  const shapes: Shape[] = new Array(count)
  const cell = Math.max(7, Math.min(width, height) / Math.sqrt(count) / 1.45)
  const margin = cell * 1.5
  const usableWidth = Math.max(1, width - margin * 2)
  const usableHeight = Math.max(1, height - margin * 2)

  for (let index = 0; index < count; index += 1) {
    const baseX = margin + random() * usableWidth
    const baseY = margin + random() * usableHeight
    const speed = 0.45 + random() * 1.4
    const offset = random() * Math.PI * 2
    const amplitude = cell * (0.7 + random() * 1.4)
    const dx = Math.sin(phase * speed + offset) * amplitude
    const dy = Math.cos(phase * (speed * 0.83) + offset) * amplitude
    const x = baseX + dx
    const y = baseY + dy
    const size = cell * (0.65 + random() * 1.1)
    const colors = palette[index % palette.length]
    const strokeWidth = 1.5
    if (index % 2 === 0) {
      shapes[index] = {
        kind: 'rect',
        key: index,
        x: x - size / 2,
        y: y - size / 2,
        width: size * 1.25,
        height: size,
        color: colors[0],
        stroke: colors[1],
        strokeWidth,
      }
    } else {
      shapes[index] = {
        kind: 'circle',
        key: index,
        cx: x,
        cy: y,
        radius: size * 0.48,
        color: colors[0],
        stroke: colors[1],
        strokeWidth,
      }
    }
  }

  return shapes
}

function percentile(sorted: number[], quantile: number): number {
  if (sorted.length === 0) {
    return 0
  }
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)
  return sorted[index]
}

export function summarizeFrames(
  timestamps: number[],
  durationMs: number,
  refreshRateHz: number
): FrameStats {
  const intervals = timestamps
    .slice(1)
    .map((timestamp, index) => timestamp - timestamps[index])
    .sort((a, b) => a - b)
  const budget = 1000 / refreshRateHz
  const missedFrames = intervals.reduce(
    (total, interval) => total + Math.max(0, Math.round(interval / budget) - 1),
    0
  )

  return {
    fps:
      durationMs > 0 && timestamps.length > 1
        ? ((timestamps.length - 1) * 1000) / durationMs
        : 0,
    frameCount: timestamps.length,
    missedFrames,
    p50Ms: percentile(intervals, 0.5),
    p90Ms: percentile(intervals, 0.9),
    p95Ms: percentile(intervals, 0.95),
    p99Ms: percentile(intervals, 0.99),
    maxMs: intervals.at(-1) ?? 0,
  }
}
