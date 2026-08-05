import React from 'react'
import {
  Canvas,
  Circle,
  Line,
  Path,
  Rect,
  Skia,
  vec,
} from '@shopify/react-native-skia'
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

/** Which Skia GPU backend this build links: `Skia.hasDevice()` exists only on the Graphite line. */
export function getSkiaBackendProof(): Record<string, string | boolean> {
  let hasDevice = false
  try {
    hasDevice = Skia.hasDevice?.() ?? false
  } catch {
    hasDevice = false
  }
  return {
    backend: hasDevice ? 'graphite' : 'ganesh',
    graphiteEnabled: hasDevice,
    nativeDeviceAvailable: hasDevice,
  }
}

export function SkiaRenderer({ width, height, shapes }: Props): React.JSX.Element {
  return (
    <Canvas
      style={{ width, height }}
      opaque
      colorSpace="srgb"
      highBitDepth={false}
    >
      <Rect x={0} y={0} width={width} height={height} color="#05070d" />
      {shapes.map((shape) => {
        if (shape.kind === 'rect') {
          return (
            <React.Fragment key={shape.key}>
              <Rect {...shape} color={shape.color} />
              <Rect
                {...shape}
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
              p1={vec(shape.x1, shape.y1)}
              p2={vec(shape.x2, shape.y2)}
              color={shape.color}
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
