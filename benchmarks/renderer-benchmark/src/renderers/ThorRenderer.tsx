import React from 'react'
import {
  Canvas,
  Circle,
  Line,
  Polygon,
  Rect,
} from 'react-native-nitro-thor'
import type { RendererId, Shape } from '../types'

type Props = {
  renderer: Extract<RendererId, 'thor-cpu' | 'thor-gpu'>
  width: number
  height: number
  shapes: Shape[]
}

export function ThorRenderer({
  renderer,
  width,
  height,
  shapes,
}: Props): React.JSX.Element {
  const backend = renderer === 'thor-cpu' ? 'cpu' : 'gpu'
  return (
    <Canvas backend={backend} style={{ width, height }}>
      <Rect x={0} y={0} width={width} height={height} fill="#05070d" />
      {shapes.map((shape) => {
        if (shape.kind === 'rect') {
          return (
            <React.Fragment key={shape.key}>
              <Rect
                x={shape.x}
                y={shape.y}
                width={shape.width}
                height={shape.height}
                fill={shape.color}
              />
              <Rect
                x={shape.x}
                y={shape.y}
                width={shape.width}
                height={shape.height}
                stroke={shape.stroke}
                strokeWidth={shape.strokeWidth}
              />
            </React.Fragment>
          )
        }
        if (shape.kind === 'circle') {
          return (
            <React.Fragment key={shape.key}>
              <Circle
                cx={shape.cx}
                cy={shape.cy}
                radius={shape.radius}
                fill={shape.color}
              />
              <Circle
                cx={shape.cx}
                cy={shape.cy}
                radius={shape.radius}
                stroke={shape.stroke}
                strokeWidth={shape.strokeWidth}
              />
            </React.Fragment>
          )
        }
        if (shape.kind === 'line') {
          return (
            <Line
              key={shape.key}
              x1={shape.x1}
              y1={shape.y1}
              x2={shape.x2}
              y2={shape.y2}
              stroke={shape.color}
              strokeWidth={shape.strokeWidth}
            />
          )
        }
        return (
          <Polygon
            key={shape.key}
            points={shape.points}
            fill={shape.color}
            stroke={shape.stroke}
            strokeWidth={shape.strokeWidth}
          />
        )
      })}
    </Canvas>
  )
}
