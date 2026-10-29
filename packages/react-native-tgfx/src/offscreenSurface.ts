import { NitroModules } from 'react-native-nitro-modules'
import type {
  TgfxOffscreenSurface,
  TgfxOffscreenSurfaceFactory,
} from './specs/TgfxOffscreenSurface.nitro'
import type { ColorSpace } from './types'

let factory: TgfxOffscreenSurfaceFactory | null = null
function surfaces(): TgfxOffscreenSurfaceFactory {
  factory ??= NitroModules.createHybridObject<TgfxOffscreenSurfaceFactory>(
    'TgfxOffscreenSurfaceFactory'
  )
  return factory
}

export interface OffscreenSurfaceOptions {
  /** Logical points, like a `<Canvas>` of the same size. */
  width: number
  height: number
  /** Pixels per point. Defaults to 1. */
  pixelRatio?: number
  /** Defaults to false, which leaves what the scene did not cover transparent. */
  opaque?: boolean
  /**
   * The surface's colour space, fixed at creation like a view's. Defaults to
   * `'srgb'`.
   */
  colorSpace?: ColorSpace
}

/**
 * A retained GPU surface for headless rendering - create once, render many.
 *
 * Attach a `Scene` (`scene.attach(surface)`), or drive it directly with the
 * `setScene`/`setValues` view contract; `flush()` renders on a dedicated
 * offscreen worker, and `toImage()`/`save()` read the frame back only when
 * asked. Free it with `dispose()` - the GPU memory is explicit-lifetime.
 *
 * For a single export, `renderToImage` stays the cheaper call: a surface earns
 * its keep when the same scene renders repeatedly.
 */
export function createOffscreenSurface(
  options: OffscreenSurfaceOptions
): TgfxOffscreenSurface {
  const ratio = options.pixelRatio ?? 1
  if (!Number.isFinite(ratio) || ratio <= 0) {
    throw new Error(
      `[tgfx] createOffscreenSurface: pixelRatio must be a positive finite number, got ${String(
        options.pixelRatio
      )}`
    )
  }
  return surfaces().create(
    options.width,
    options.height,
    ratio,
    options.opaque ?? false,
    options.colorSpace ?? 'srgb'
  )
}
