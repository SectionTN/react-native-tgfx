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
          amplitude: shape.kind === 'rect' ? shape.height : shape.radius * 2,
          speed: 0.45 + (index % 7) * 0.2,
          offset: index,
        }
      }),
    [shapes]
  )

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
