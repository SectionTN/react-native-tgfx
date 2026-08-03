// The "before" side of the bitmap A/B — see before/README.md. The relative
// imports are written for its destination, src/renderers/, not for here.
//
// Identical to src/renderers/TgfxImagesRenderer.tsx except for the one thing
// under test: `<Image image>` takes the base64 payload directly, which is what
// `main` accepts (`ImageProps.image: Animated<string>`). Everything else — the
// scene, the four textures, the node census published to the acceptance gate —
// is the same on both sides, so the only difference the numbers can be
// attributed to is the transport.
import React from 'react'
import { Canvas, Image, Rect, useImage } from 'react-native-tgfx'
import { TEXTURES } from '../assets/textures'
import type { Shape } from '../types'

/**
 * What the scene last actually had to draw, published for `backendProof`.
 *
 * The base64 transport never exposed decoded dimensions to JS, so this side can
 * only report the payload count and the node census — which is what the gate
 * checks, and enough to reject the empty scene an earlier run of this benchmark
 * published timings for.
 */
export const drawnBitmaps = { textures: 0, texturePixels: 0, imageNodes: 0 }

type Props = {
  width: number
  height: number
  shapes: Shape[]
}

export function TgfxImagesRenderer({
  width,
  height,
  shapes,
}: Props): React.JSX.Element {
  const images = [
    useImage(TEXTURES[0]!),
    useImage(TEXTURES[1]!),
    useImage(TEXTURES[2]!),
    useImage(TEXTURES[3]!),
  ]
  const ready = images.every(image => image != null && image !== '')
  const nodes = shapes.filter(
    shape => shape.kind === 'rect' || shape.kind === 'circle'
  ).length

  React.useEffect(() => {
    drawnBitmaps.textures = ready ? images.length : 0
    drawnBitmaps.texturePixels = 0
    drawnBitmaps.imageNodes = ready ? nodes : 0
  })

  return (
    <Canvas style={{ width, height }}>
      <Rect x={0} y={0} width={width} height={height} color="#05070d" />
      {ready &&
        shapes.map(shape => {
          const image = images[shape.key % images.length]!
          if (shape.kind === 'rect') {
            return (
              <Image
                key={shape.key}
                x={shape.x}
                y={shape.y}
                width={shape.width}
                height={shape.height}
                image={image}
                fit="cover"
              />
            )
          }
          if (shape.kind === 'circle') {
            return (
              <Image
                key={shape.key}
                x={shape.cx - shape.radius}
                y={shape.cy - shape.radius}
                width={shape.radius * 2}
                height={shape.radius * 2}
                image={image}
                fit="cover"
              />
            )
          }
          return null
        })}
    </Canvas>
  )
}
