import React, { useMemo } from 'react'
import { makeMutable, useFrameCallback } from 'react-native-reanimated'
import { Canvas, Circle, Rect } from 'react-native-tgfx'
import type { Shape } from '../types'

type Props = {
  width: number
  height: number
  shapes: Shape[]
}

/**
 * The animated counterpart of {@link TgfxRenderer}: the React tree is built once
 * and never re-rendered, and every position is a Reanimated SharedValue driven
 * on the UI thread. The scene therefore travels to native exactly once, and the
 * per-frame cost is only the value-slot push — which is what this measures.
 *
 * JS FPS is meaningless here by design (no JS work per frame); main-thread FPS
 * and process CPU are the numbers that matter.
 */
export function TgfxAnimatedRenderer({ width, height, shapes }: Props): React.JSX.Element {
  const slots = useMemo(
    () => shapes.map((shape) => ({
      x: makeMutable(shape.kind === 'circle' ? shape.cx : shape.kind === 'rect' ? shape.x : 0),
      y: makeMutable(shape.kind === 'circle' ? shape.cy : shape.kind === 'rect' ? shape.y : 0),
    })),
    [shapes]
  )

  // One UI-thread callback drives every slot, so nothing crosses to JS.
  useFrameCallback((frame) => {
    'worklet'
    const phase = (frame.timeSinceFirstFrame ?? 0) / 1000
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]!
      const speed = 0.45 + (i % 7) * 0.2
      slot.x.value = 40 + ((Math.sin(phase * speed + i) + 1) / 2) * (width - 80)
      slot.y.value = 40 + ((Math.cos(phase * speed * 0.83 + i) + 1) / 2) * (height - 80)
    }
  }, true)

  return (
    <Canvas style={{ width, height }}>
      <Rect x={0} y={0} width={width} height={height} color="#05070d" />
      {shapes.map((shape, index) => {
        const slot = slots[index]!
        if (shape.kind === 'circle') {
          return (
            <Circle
              key={shape.key}
              cx={slot.x}
              cy={slot.y}
              r={shape.radius}
              color={shape.color}
            />
          )
        }
        if (shape.kind === 'rect') {
          return (
            <Rect
              key={shape.key}
              x={slot.x}
              y={slot.y}
              width={shape.width}
              height={shape.height}
              color={shape.color}
            />
          )
        }
        return null
      })}
    </Canvas>
  )
}
