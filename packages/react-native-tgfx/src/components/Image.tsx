import React from 'react'
import type { ImageProps } from '../types'
import { useImage } from '../hooks/useImage'
import { TgfxImage } from './drawings'

export interface ImageSourceProps extends Omit<ImageProps, 'image'> {
  /** A `require()`'d asset, a file path or URI, SVG markup, or base64 bytes. */
  source: number | string
}

/**
 * The image component: hand it the source and it decodes, registers, and
 * draws when ready — no hook, no null-gating in user code.
 *
 * ```tsx
 * <Canvas style={{ width: 300, height: 200 }}>
 *   <TgfxImage source={require('./cat.png')} x={0} y={0} width={300} height={200} fit="cover" />
 *   <TgfxImage source="https://picsum.photos/300/200" x={0} y={200} width={300} height={200} />
 * </Canvas>
 * ```
 *
 * Nothing draws until the decode lands (a frame or two for a local asset), and
 * a failed load warns and stays empty — `useImage`'s behaviour, which this
 * wraps. The handle lives for the component's life; remounting the same source
 * re-decodes through the shared cache.
 *
 * The trade: this is a function component, so a canvas containing one leaves
 * the direct-nodes fast path and reconciles through React. Irrelevant for
 * typical scenes; for hundreds of animated nodes, load with `useImage` (or
 * `loadImage`) and keep `<TgfxImage image={...}>`, which is a plain host tag.
 */
export function Image({
  source,
  children,
  ...rest
}: ImageSourceProps): React.ReactElement {
  const image = useImage(source)
  // Always the node, image or not: `image: null` draws nothing by contract,
  // and keeping the node mounted keeps a `ref` handle bound across a source
  // flip instead of unbinding it while the next decode is in flight.
  return (
    <TgfxImage image={image} {...rest}>
      {children}
    </TgfxImage>
  )
}
