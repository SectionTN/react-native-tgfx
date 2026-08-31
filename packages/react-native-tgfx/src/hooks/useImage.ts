import { useEffect, useState } from 'react'
import { NitroModules, type UInt64 } from 'react-native-nitro-modules'
import type {
  CacheInfo,
  PixelFormat,
  TgfxImage,
  TgfxImageFactory,
} from '../specs/TgfxImage.nitro'

export type { CacheInfo } from '../specs/TgfxImage.nitro'
import { loadSource, looksLikeSvgMarkup } from './source'

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
 * What tgfx is caching right now, in bytes: resident decoded pixels and their
 * budget, GPU resources across the live canvases (as of each canvas's last
 * frame), and the shared offscreen context's GPU resources.
 */
export function getCacheInfo(): CacheInfo {
  return images().getCacheInfo()
}

/**
 * Drop every tgfx cache now. Decoded CPU pixels are freed before this returns;
 * each live canvas drops its GPU resource cache on its next frame, which this
 * schedules — so process memory falls within a frame, without waiting for any
 * budget eviction. What is still on screen re-decodes and re-uploads lazily.
 */
export function purgeCaches(): void {
  images().purgeCaches()
}

/**
 * Wrap a platform hardware buffer — an `AHardwareBuffer*` on Android, a
 * `CVPixelBufferRef` on iOS — as an image handle. Pass
 * `frame.getNativeBuffer().pointer`.
 *
 * Zero-copy and synchronous: the buffer is imported straight to a GPU texture,
 * with no decode and no CPU round trip. For a stream of frames, keep the handle
 * and call `image.setNativeBuffer(...)` per frame — native code imports the new
 * buffer and replaces the registry entry, while the draw path resolves the
 * stable handle every frame. Nothing is re-committed, replacement schedules a
 * redraw, and an undrawn frame is superseded by the next rather than queued
 * behind it. The previous buffer is released on replacement; do not write into
 * a buffer while the handle still points at it.
 *
 * Such a handle is not accounted against the decoded-pixel budget: the memory
 * belongs to whoever produced the buffer.
 *
 * A worklet, so a camera frame processor can call it directly: the buffer is
 * only alive for the duration of the callback, so the handle has to be made
 * where the frame is, not hopped to the JS thread first.
 *
 * @remarks
 * Unlike every other function here, this one does **not** share the memoised
 * factory: a worklet gets its own copy of module state, so it builds a
 * `TgfxImageFactory` per call. That is deliberate and cheap for the intended
 * once-per-stream use, but it is not free — do not call it per frame. Use
 * `image.setNativeBuffer(...)` for the second and every later buffer.
 *
 * **`buffer` is a raw pointer, and nothing here can check it.** It is only
 * valid for as long as its producer says it is — for a VisionCamera frame, the
 * body of the `onFrame` callback. Passing a stale or already-released pointer
 * is a use-after-free that will not throw: it imports whatever memory is now at
 * that address. Never store one, never let one outlive the callback it came
 * from, and release the producer's own reference (`nativeBuffer.release()`)
 * only after this call, or `setNativeBuffer`, has returned.
 */
export function imageFromNativeBuffer(
  buffer: UInt64,
  format: PixelFormat = 'bt601-limited'
): TgfxImage {
  'worklet'
  return NitroModules.createHybridObject<TgfxImageFactory>(
    'TgfxImageFactory'
  ).fromNativeBuffer(buffer, format)
}

/** Wrap decoded premultiplied RGBA pixels as a handle. `rowBytes` is the stride in bytes (a multiple of 4), tightly packed when omitted. A native module's own buffer is borrowed — do not write into it while the handle lives; a JS-constructed `ArrayBuffer` is copied. Per-frame like a camera frame: it cannot be derived from or encoded. */
export function imageFromPixels(
  pixels: ArrayBuffer,
  width: number,
  height: number,
  rowBytes?: number
): TgfxImage {
  'worklet'
  return NitroModules.createHybridObject<TgfxImageFactory>(
    'TgfxImageFactory'
  ).fromPixels(pixels, width, height, rowBytes)
}

/**
 * Load an image source into a native handle, outside React.
 *
 * Same sources as {@link useImageState}, `.svg` included — a `require()`d
 * asset, a path or URI, base64, or an SVG document as markup. The caller owns
 * the handle and must `dispose()` it; the hooks do that for you.
 */
export function loadImage(
  source: number | string,
  signal?: AbortSignal
): Promise<TgfxImage> {
  // Ahead of the URI routing: markup is neither a path nor base64, and would
  // otherwise be base64-decoded into nothing. The one place this decision is
  // made — `useImageState` comes through here rather than repeating it.
  if (typeof source === 'string' && looksLikeSvgMarkup(source)) {
    return images().fromSvg(source)
  }
  return loadSource(source, images(), signal)
}

export interface ImageState {
  readonly data: TgfxImage | null
  readonly error: Error | null
  readonly loading: boolean
}

const PENDING: ImageState = Object.freeze({
  data: null,
  error: null,
  loading: true,
})

/**
 * Load an image source into a native handle, with its loading and error state.
 *
 * Accepts a `require('./pic.png')` asset, an `http(s)://`, `file://`, `data:` or
 * `asset:`/`content:` URI, a raw base64 string, or an SVG document as markup.
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
    setState(PENDING)
    let loaded: TgfxImage | null = null
    const aborter = new AbortController()

    async function load(): Promise<void> {
      // The point of the handle: a local file is decoded natively and never crosses into JS.
      loaded = await loadImage(source, aborter.signal)

      if (!active) {
        loaded.dispose()
        return
      }
      setState({ data: loaded, error: null, loading: false })
    }

    load().catch((e: unknown) => {
      if (!active) {
        return
      }
      const error = e instanceof Error ? e : new Error(String(e))
      console.warn('[tgfx] useImage failed to load:', error)
      setState({ data: null, error, loading: false })
    })
    return () => {
      active = false
      aborter.abort()
      // Deterministic rather than waiting for GC: the native side holds decoded pixels.
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
