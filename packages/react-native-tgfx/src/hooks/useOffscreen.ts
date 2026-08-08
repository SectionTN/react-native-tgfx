import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { renderToImage, type RenderToImageOptions } from '../offscreen'
import type { TgfxImage } from '../specs/TgfxImage.nitro'
import type { Orientation, ImageSampling } from '../specs/TgfxImage.nitro'

/**
 * Render a scene offscreen and get the image handle back, disposed for you when
 * the component unmounts or the inputs change.
 *
 * The declarative half of {@link renderToImage}: null on the first frame, then
 * the handle once the GPU has drawn it.
 *
 * ```tsx
 * const badge = useOffscreenImage(<Badge count={n} />, { width: 64, height: 64 })
 * return <Canvas>{badge && <Image image={badge} x={0} y={0} width={64} height={64} />}</Canvas>
 * ```
 *
 * `element` is read on every change, so build it inline only if the scene
 * really did change — otherwise memoise it, or the render repeats every commit.
 */
export function useOffscreenImage(
  element: ReactNode,
  options: RenderToImageOptions
): TgfxImage | null {
  const [image, setImage] = useState<TgfxImage | null>(null)
  const { width, height, pixelRatio, opaque } = options

  useEffect(() => {
    let live = true
    let made: TgfxImage | null = null
    renderToImage(element, { width, height, pixelRatio, opaque })
      .then((result) => {
        if (!live) {
          // Unmounted mid-render: nobody will ever draw it, so drop it now.
          result.dispose()
          return
        }
        made = result
        setImage(result)
      })
      .catch((error: unknown) => {
        if (live) {
          console.warn('[tgfx] useOffscreenImage:', error)
        }
      })
    return () => {
      live = false
      made?.dispose()
      setImage(null)
    }
  }, [element, width, height, pixelRatio, opaque])

  return image
}

/** One derivation to take from an image, for {@link useDerivedImage}. */
export type Derivation =
  | { type: 'subset'; x: number; y: number; width: number; height: number }
  | { type: 'scaled'; width: number; height: number; sampling?: ImageSampling }
  | { type: 'oriented'; orientation: Orientation }
  | { type: 'blurred'; blurX: number; blurY: number }

/**
 * Derive a handle from another and dispose it with the component.
 *
 * The declarative half of `image.scaled()` and friends. Returns null while the
 * source is still loading, so it composes with {@link useImage} directly.
 *
 * ```tsx
 * const photo = useImage(require('./photo.jpg'))
 * const thumb = useDerivedImage(photo, { type: 'scaled', width: 200, height: 200 })
 * ```
 */
export function useDerivedImage(
  source: TgfxImage | null,
  derivation: Derivation
): TgfxImage | null {
  // Spread into the deps so an inline object literal does not re-derive per render.
  const key = JSON.stringify(derivation)
  const derived = useMemo(() => {
    if (source == null) {
      return null
    }
    const step = JSON.parse(key) as Derivation
    try {
      switch (step.type) {
        case 'subset':
          return source.subset(step.x, step.y, step.width, step.height)
        case 'scaled':
          return source.scaled(step.width, step.height, step.sampling)
        case 'oriented':
          return source.oriented(step.orientation)
        case 'blurred':
          return source.blurred(step.blurX, step.blurY)
      }
    } catch (error) {
      console.warn('[tgfx] useDerivedImage:', error)
      return null
    }
  }, [source, key])

  useEffect(() => () => derived?.dispose(), [derived])
  return derived
}
