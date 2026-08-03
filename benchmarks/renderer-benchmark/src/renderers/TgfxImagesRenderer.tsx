import React from 'react'
import { Canvas, Image, Rect, useImage } from 'react-native-tgfx'
import { TEXTURES } from '../assets/textures'
import type { Shape } from '../types'

/**
 * What the scene last actually had to draw, published for `backendProof`.
 *
 * A renderer id in the result is a label; these are measurements taken from the
 * decoded handles and the emitted node list. A run whose textures never loaded
 * reports zeros here and the acceptance gate rejects it, so "the benchmark
 * silently measured an empty scene" cannot happen twice.
 */
export const drawnBitmaps = { textures: 0, texturePixels: 0, imageNodes: 0 }

type Props = {
  width: number
  height: number
  shapes: Shape[]
}

/**
 * The bitmap-heavy scene: every object is an `<Image>` rather than a shape, so
 * each commit carries as many image references as there are objects.
 *
 * This is the workload the base64 transport was worst at — a per-node hash of
 * the whole payload on every compile — and the one the native handle makes
 * free. Positions move every frame, so the scene really is recompiled.
 *
 * Four *distinct* textures, because the string table interns by value: one
 * shared payload would hide how the transport scales with image bytes.
 */
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
  const ready = images.every(image => image != null)
  const nodes = shapes.filter(
    shape => shape.kind === 'rect' || shape.kind === 'circle'
  ).length

  React.useEffect(() => {
    drawnBitmaps.textures = ready ? images.length : 0
    drawnBitmaps.texturePixels = ready
      ? images.reduce((sum, image) => sum + image!.width * image!.height, 0)
      : 0
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
