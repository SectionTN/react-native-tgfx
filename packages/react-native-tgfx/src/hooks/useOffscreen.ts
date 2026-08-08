import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  renderToImage,
  renderToPdf,
  renderToSvg,
  type PdfMetadata,
  type PdfPage,
  type RenderToImageOptions,
  type RenderToSvgOptions,
} from '../offscreen'
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
 * An inline `element` is a new object every render, so pass `deps` — the values
 * the scene actually depends on — or memoise the tree. Without either, every
 * parent render re-exports, and each export takes the shared GPU device lock.
 */
export function useOffscreenImage(
  element: ReactNode,
  options: RenderToImageOptions,
  deps?: unknown[]
): TgfxImage | null {
  const [image, setImage] = useState<TgfxImage | null>(null)
  const { width, height, pixelRatio, opaque } = options
  // An inline tree is a new object every render, which would re-export every render.
  const key = deps == null ? element : JSON.stringify(deps)

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
    // Keyed on `key`, not `element`: an inline tree would re-export every render.
  }, [key, width, height, pixelRatio, opaque])

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

/**
 * Render a scene to SVG markup and get the text back when it is ready.
 *
 * The declarative half of {@link renderToSvg}: null on the first frame, then
 * the document. Pass `deps` — the values the scene depends on — or memoise the
 * tree, or every parent render re-exports.
 */
export function useOffscreenSvg(
  element: ReactNode,
  options: RenderToSvgOptions,
  deps?: unknown[]
): string | null {
  const [svg, setSvg] = useState<string | null>(null)
  const { width, height, textAsPaths } = options
  const key = deps == null ? element : JSON.stringify(deps)

  useEffect(() => {
    let live = true
    renderToSvg(element, { width, height, textAsPaths })
      .then((text) => {
        if (live) {
          setSvg(text)
        }
      })
      .catch((error: unknown) => {
        if (live) {
          console.warn('[tgfx] useOffscreenSvg:', error)
        }
      })
    return () => {
      live = false
      setSvg(null)
    }
    // Keyed on `key`, not `element`: an inline tree would re-export every render.
  }, [key, width, height, textAsPaths])

  return svg
}

/** What {@link useOffscreenPdf} reports about the file it keeps up to date. */
export interface PdfExportState {
  /** The path once written, null until then. */
  path: string | null
  pending: boolean
  error: Error | null
}

/**
 * Keep a PDF on disk in step with a scene: it writes on mount and rewrites
 * whenever `path`, `pages` or `metadata` change.
 *
 * The declarative half of {@link renderToPdf} — a file that reflects the scene,
 * rather than a call you make. Memoise `pages`, or an inline array rewrites the
 * document every render.
 */
export function useOffscreenPdf(
  path: string,
  pages: PdfPage[],
  metadata?: PdfMetadata
): PdfExportState {
  const [state, setState] = useState<PdfExportState>({
    path: null,
    pending: true,
    error: null,
  })

  useEffect(() => {
    let live = true
    setState({ path: null, pending: true, error: null })
    renderToPdf(path, pages, metadata)
      .then(() => {
        if (live) {
          setState({ path, pending: false, error: null })
        }
      })
      .catch((error: unknown) => {
        if (live) {
          setState({
            path: null,
            pending: false,
            error: error instanceof Error ? error : new Error(String(error)),
          })
        }
      })
    return () => {
      live = false
    }
  }, [path, pages, metadata])

  return state
}
