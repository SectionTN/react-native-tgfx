import React, { useMemo } from 'react'
import { makeMutable, useFrameCallback } from 'react-native-reanimated'
import { Canvas, Circle, Rect } from 'react-native-tgfx'
import type { Shape } from '../types'

type Props = {
  width: number
  height: number
  shapes: Shape[]
  animate: boolean
}

function unsupported(shape: Shape): never {
  throw new Error(`TgfxAnimatedRenderer cannot draw shape kind "${shape.kind}"`)
}

/**
 * The animated counterpart of {@link TgfxRenderer}: the React tree is built once
 * and never re-rendered, and every position is a Reanimated SharedValue driven
 * on the UI thread. The scene therefore travels to native exactly once, and the
 * per-frame cost is only the value-slot push — which is what this measures.
 *
 * That invariant needs two things to hold, and both are load-bearing: the
 * `shapes` array identity must be stable (`BenchmarkScreen` pins the animated
 * scene to phase 0 *including* in the memo deps), and this component must be
 * memoised, because the screen above it re-renders on every `requestAnimationFrame`
 * and any re-render here recompiles the whole scene via the reconciler commit.
 *
 * Draw load is comparable to {@link TgfxRenderer}, `SkiaRenderer` and
 * `ThorRenderer` in both respects that matter to a GPU benchmark:
 *
 * - **Draw calls** are identical — a fill and a stroke per shape plus the
 *   background rect, so `objectCount` buys `1 + 2N` nodes in every adapter.
 * - **Coverage** is equivalent, because each slot only *offsets* from the
 *   `buildScene` position its shape was built at, instead of being remapped onto
 *   a new curve. Occupancy of a 40x40 grid at 1080x2400, N=3200, stays within
 *   ~0.015 of `buildScene` across phases (~0.85 against ~0.86), so fragment
 *   count, overdraw and tile residency land in the same regime.
 *
 * Positions are *not* pixel-identical to `buildScene` at the same phase — the
 * orbit here is per-slot rather than the seeded per-shape one — so an animating
 * frame is comparable in load, not reproducible against another adapter. The
 * frozen frame is exact: `animate` is false there, so no slot is ever written
 * and every node sits on its `buildScene` phase-0 position, which is what makes
 * `tgfx` and `tgfx-animated` pixel-comparable in scripts/pixel-gate.mjs.
 *
 * JS FPS is meaningless here by design (no JS work per frame); main-thread FPS
 * and process CPU are the numbers that matter.
 */
function AnimatedScene({ width, height, shapes, animate }: Props): React.JSX.Element {
  const slots = useMemo(
    () =>
      shapes.map((shape, index) => {
        if (shape.kind !== 'rect' && shape.kind !== 'circle') {
          unsupported(shape)
        }
        const baseX = shape.kind === 'rect' ? shape.x : shape.cx
        const baseY = shape.kind === 'rect' ? shape.y : shape.cy
        return {
          x: makeMutable(baseX),
          y: makeMutable(baseY),
          baseX,
          baseY,
          // Wobble by roughly the shape's own extent, the scale buildScene moves at.
          amplitude: shape.kind === 'rect' ? shape.height : shape.radius * 2,
          speed: 0.45 + (index % 7) * 0.2,
          offset: index,
        }
      }),
    [shapes]
  )

  // One UI-thread callback drives every slot, so nothing crosses to JS.
  useFrameCallback((frame) => {
    'worklet'
    const phase = (frame.timeSinceFirstFrame ?? 0) / 1000
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]!
      slot.x.value = slot.baseX + Math.sin(phase * slot.speed + slot.offset) * slot.amplitude
      slot.y.value =
        slot.baseY + Math.cos(phase * slot.speed * 0.83 + slot.offset) * slot.amplitude
    }
  }, animate)

  return (
    <Canvas style={{ width, height }}>
      <Rect x={0} y={0} width={width} height={height} color="#05070d" />
      {shapes.map((shape, index) => {
        const slot = slots[index]!
        if (shape.kind === 'circle') {
          return (
            <React.Fragment key={shape.key}>
              <Circle cx={slot.x} cy={slot.y} r={shape.radius} color={shape.color} />
              <Circle
                cx={slot.x}
                cy={slot.y}
                r={shape.radius}
                color={shape.stroke}
                style="stroke"
                strokeWidth={shape.strokeWidth}
              />
            </React.Fragment>
          )
        }
        if (shape.kind === 'rect') {
          return (
            <React.Fragment key={shape.key}>
              <Rect
                x={slot.x}
                y={slot.y}
                width={shape.width}
                height={shape.height}
                color={shape.color}
              />
              <Rect
                x={slot.x}
                y={slot.y}
                width={shape.width}
                height={shape.height}
                color={shape.stroke}
                style="stroke"
                strokeWidth={shape.strokeWidth}
              />
            </React.Fragment>
          )
        }
        return unsupported(shape)
      })}
    </Canvas>
  )
}

export const TgfxAnimatedRenderer = React.memo(AnimatedScene)
