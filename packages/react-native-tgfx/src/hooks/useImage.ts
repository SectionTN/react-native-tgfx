import { useEffect, useState } from 'react'
import { NitroModules, type UInt64 } from 'react-native-nitro-modules'
import type {
  PixelFormat,
  TgfxImage,
  TgfxImageFactory,
} from '../specs/TgfxImage.nitro'
import { loadSource } from './source'

/** The native image factory. Created once, on first use. */
let factory: TgfxImageFactory | null = null
function images(): TgfxImageFactory {
  factory ??=
    NitroModules.createHybridObject<TgfxImageFactory>('TgfxImageFactory')
  return factory
}

/**
 * Byte budget for decoded images. A decoded image is resident twice — as CPU
 * pixels and as the GPU texture uploaded from them — so this is applied to both
 * the pixel cache and the tgfx context's resource cache. Defaults to 64 MB.
 */
export function setImageCacheLimit(bytes: number): void {
  images().setCacheLimit(bytes)
}

/**
 * Wrap a platform hardware buffer — an `AHardwareBuffer*` on Android, a
 * `CVPixelBufferRef` on iOS — as an image handle. Pass
 * `frame.getNativeBuffer().pointer`.
 *
 * Zero-copy and synchronous: the buffer is imported straight to a GPU texture,
 * with no decode and no CPU round trip. For a stream of frames, keep the handle
 * and call `image.setNativeBuffer(...)` per frame — the draw path resolves the
 * handle every frame, so nothing is re-committed, the swap alone schedules a
 * redraw, and an undrawn frame is superseded by the next rather than queued
 * behind it. The previous buffer is released on the swap; do not write into a
 * buffer while the handle still points at it.
 *
 * Such a handle is not accounted against the decoded-pixel budget: the memory
 * belongs to whoever produced the buffer.
 */
export function imageFromNativeBuffer(
  buffer: UInt64,
  format: PixelFormat = 'bt601-limited'
): TgfxImage {
  return images().fromNativeBuffer(buffer, format)
}

export interface ImageState {
  /** The native handle, or `null` while loading and after a failure. */
  readonly data: TgfxImage | null
  /** Why the current source failed, or `null`. */
  readonly error: Error | null
  /** True from the moment a source starts loading until it settles. */
  readonly loading: boolean
}

// Handed straight to the caller on first render, so a mutation would leak into
// every component mounted after it. Frozen rather than rebuilt: the shared
// identity is what lets React bail out of the redundant initial re-render.
const PENDING: ImageState = Object.freeze({
  data: null,
  error: null,
  loading: true,
})

/**
 * Load an image source into a native handle, with its loading and error state.
 *
 * Accepts a `require('./pic.png')` asset, an `http(s)://`, `file://`, `data:` or
 * `asset:`/`content:` URI, or a raw base64 string.
 *
 * A local file is opened natively, so its bytes never enter JS at all. Only a
 * remote or Metro-served URI still goes through `fetch`, and then as an
 * `ArrayBuffer` — nothing is ever base64-encoded on the JS thread.
 *
 * `data` is cleared the moment `source` changes, so a slow or failing load can
 * never leave the previous image on screen. The handle is disposed when the
 * source changes or the component unmounts.
 */
export function useImageState(source: number | string): ImageState {
  const [state, setState] = useState<ImageState>(PENDING)

  useEffect(() => {
    let active = true
    // A stale image under a new source is worse than an empty one.
    setState(PENDING)
    let loaded: TgfxImage | null = null

    async function load(): Promise<void> {
      // The whole point of the handle: a local file's bytes are read and decoded
      // natively and never cross into JS.
      loaded = await loadSource(source, images())

      if (!active) {
        loaded.dispose()
        return
      }
      setState({ data: loaded, error: null, loading: false })
    }

    load().catch((e: unknown) => {
      const error = e instanceof Error ? e : new Error(String(e))
      console.warn('[tgfx] useImage failed to load:', error)
      if (active) {
        setState({ data: null, error, loading: false })
      }
    })
    return () => {
      active = false
      // Deterministic, rather than waiting for the JS handle to be collected:
      // the native side is holding decoded pixels.
      loaded?.dispose()
    }
  }, [source])

  return state
}

/**
 * The handle only, `null` until it is available. Use `useImageState` when you
 * need to tell "still loading" from "failed".
 */
export function useImage(source: number | string): TgfxImage | null {
  return useImageState(source).data
}
