import React from 'react'
import {
  Canvas,
  Circle,
  Line,
  Path,
  Rect,
} from 'react-native-tgfx'
import type { Shape } from '../types'

type Props = {
  width: number
  height: number
  shapes: Shape[]
}

function polygonPath(points: number[]): string {
  let path = `M${points[0]} ${points[1]}`
  for (let index = 2; index < points.length; index += 2) {
    path += ` L${points[index]} ${points[index + 1]}`
  }
  return `${path} Z`
}

export function TgfxRenderer({ width, height, shapes }: Props): React.JSX.Element {
  return (
    <Canvas style={{ width, height }}>
      <Rect x={0} y={0} width={width} height={height} color="#05070d" />
      {shapes.map((shape) => {
        if (shape.kind === 'rect') {
          return (
            <React.Fragment key={shape.key}>
              <Rect
                x={shape.x}
                y={shape.y}
                width={shape.width}
                height={shape.height}
                color={shape.color}
              />
              <Rect
                x={shape.x}
                y={shape.y}
                width={shape.width}
                height={shape.height}
                color={shape.stroke}
                style="stroke"
                strokeWidth={shape.strokeWidth}
              />
            </React.Fragment>
          )
        }
        if (shape.kind === 'circle') {
          return (
            <React.Fragment key={shape.key}>
              <Circle cx={shape.cx} cy={shape.cy} r={shape.radius} color={shape.color} />
              <Circle
                cx={shape.cx}
                cy={shape.cy}
                r={shape.radius}
                color={shape.stroke}
                style="stroke"
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
              color={shape.color}
              style="stroke"
              strokeWidth={shape.strokeWidth}
            />
          )
        }
        const path = polygonPath(shape.points)
        return (
          <React.Fragment key={shape.key}>
            <Path path={path} color={shape.color} />
            <Path
              path={path}
              color={shape.stroke}
              style="stroke"
              strokeWidth={shape.strokeWidth}
            />
          </React.Fragment>
        )
      })}
    </Canvas>
  )
}
