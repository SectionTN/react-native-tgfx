import { useCallback, useEffect, useState } from 'react'
import type { UInt64 } from 'react-native-nitro-modules'
import { requireReanimated, worklets } from '../reanimated/peer'
import type { PixelFormat, TgfxImage } from '../specs/TgfxImage.nitro'
import { imageFromNativeBuffer } from './useImage'

/** The buffer a {@link FrameLike} hands over, valid only inside the callback. */
export interface NativeBufferLike {
  pointer: UInt64
  release(): void
}

/**
 * What {@link useCameraFrame} needs of a frame, structurally — so it works for
 * a VisionCamera `Frame` and for any other producer, and costs this package no
 * dependency on either.
 */
export interface FrameLike {
  getNativeBuffer(): NativeBufferLike
  pixelFormat: string
  orientation: string
  isMirrored: boolean
  width: number
  height: number
  dispose(): void
}

/** How the buffer is oriented, read off the frame rather than assumed. */
export interface CameraFramePosture {
  rotation: number
  mirror: boolean
  width: number
  height: number
}

export interface CameraFrameSource<F extends FrameLike = FrameLike> {
  image: TgfxImage | null
  posture: CameraFramePosture
  onFrame: (frame: F) => void
}

export interface CameraFrameOptions<F extends FrameLike = FrameLike> {
  /**
   * Map the producer's `pixelFormat` to the one tgfx imports with. A worklet —
   * it runs on the frame thread.
   *
   * The default reads the string: `rgb`/`rgba`/`bgra` import as `'rgba'`,
   * `709`/`2020` pick that matrix, anything else is BT.601, and a `-full`
   * suffix selects the full-range variant. Override it for a producer that
   * names its formats differently, or to pin one.
   */
  format?: (frame: F) => PixelFormat
  /**
   * Map the producer's `orientation` to the clockwise degrees that cancel it.
   * A worklet. The default understands `'up' | 'right' | 'down' | 'left'`;
   * anything else is 0, which draws the frame unrotated.
   */
  rotation?: (frame: F) => number
}

const ROTATION: Record<string, 0 | 90 | 180 | 270> = {
  up: 0,
  right: 270,
  down: 180,
  left: 90,
}

function defaultFormat(pixelFormat: string): PixelFormat {
  'worklet'
  const f = pixelFormat.toLowerCase()
  if (f.startsWith('rgb') || f.startsWith('bgra') || f.startsWith('argb')) {
    return 'rgba'
  }
  const full = f.endsWith('-full') || f.includes('full-range')
  if (f.includes('2020')) {
    return full ? 'bt2020-full' : 'bt2020-limited'
  }
  if (f.includes('709')) {
    return full ? 'bt709-full' : 'bt709-limited'
  }
  return full ? 'bt601-full' : 'bt601-limited'
}

const UPRIGHT: CameraFramePosture = Object.freeze({
  rotation: 0,
  mirror: false,
  width: 0,
  height: 0,
})

/**
 * Turn a stream of camera frames into a `<CameraFrame>` handle.
 *
 * ```tsx
 * const { image, posture, onFrame } = useCameraFrame()
 * const output = useFrameOutput({ pixelFormat: 'yuv', onFrame })
 * // ...
 * <CameraFrame image={image} {...posture} />
 * ```
 *
 * The callback is *returned* rather than registered, so this package needs no
 * camera dependency at all and any producer of a {@link FrameLike} works.
 *
 * It owns the buffer's lifetime, which is the reason to prefer it over calling
 * {@link imageFromNativeBuffer} yourself: the raw pointer never leaves this
 * scope, so it cannot be stored, and a `try`/`finally` releases the buffer and
 * disposes the frame on every path including a throw. A leaked frame stalls a
 * bounded producer pool; a stored pointer is a use-after-free that does not
 * throw.
 *
 * The first frame creates the handle and every later one re-points it, so the
 * scene is committed once and a new frame costs one pointer swap — no React
 * render, no reconciler commit, no program recompile. `posture` only reaches
 * React state when it actually changes. The handle is disposed on unmount: an
 * external registry entry is never evicted, so nothing else would ever free it.
 *
 * `onEachFrame` is your own per-frame worklet — a detector, say. It runs inside
 * the same `try`, so work that throws still cannot leak the frame. Memoise it,
 * or the output re-registers every render.
 *
 * @remarks
 * **The frame `onEachFrame` receives dies when it returns.** Read from it and
 * let it go: do not retain it, do not call `getNativeBuffer()` on it again —
 * that is a second `+1` retain the hook will not release, and one unreleased
 * buffer stalls the producer's bounded pool — and never store
 * `getNativeBuffer().pointer` anywhere. A stale pointer does not throw; it
 * imports whatever memory is now at that address. Everything the hook itself
 * needs from the buffer is already done before your callback runs.
 *
 * Needs react-native-reanimated: the handle has to outlive one callback on the
 * producer's worklet runtime.
 */
export function useCameraFrame<F extends FrameLike = FrameLike>(
  onEachFrame?: (frame: F) => void,
  options?: CameraFrameOptions<F>
): CameraFrameSource<F> {
  const mod = requireReanimated('useCameraFrame', ['useSharedValue'])
  const scheduleOnRN = worklets().scheduleOnRN
  if (scheduleOnRN == null) {
    throw new Error(
      '[tgfx] react-native-worklets does not export scheduleOnRN, which useCameraFrame needs.'
    )
  }
  // Destructured, or an inline `{}` at the call site would re-register every render.
  const formatOf = options?.format
  const rotationOf = options?.rotation
  const [image, setImage] = useState<TgfxImage | null>(null)
  const [posture, setPosture] = useState<CameraFramePosture>(UPRIGHT)
  const handle = mod.useSharedValue!<TgfxImage | null>(null)
  const posted = mod.useSharedValue!('')

  const onImage = useCallback((h: TgfxImage) => {
    setImage(h)
  }, [])
  const onPosture = useCallback(
    (rotation: number, mirror: boolean, width: number, height: number) => {
      setPosture({ rotation, mirror, width, height })
    },
    []
  )

  const onFrame = useCallback(
    (frame: F) => {
      'worklet'
      // Acquired inside the try: a throw would skip the dispose() and stall the bounded pool.
      let buffer: NativeBufferLike | null = null
      try {
        buffer = frame.getNativeBuffer()
        // Read off the frame: `-full` imported as limited crushes the blacks.
        const format: PixelFormat =
          formatOf != null ? formatOf(frame) : defaultFormat(frame.pixelFormat)
        if (handle.value == null) {
          handle.value = imageFromNativeBuffer(buffer.pointer, format)
          scheduleOnRN(onImage, handle.value)
        } else {
          handle.value.setNativeBuffer(buffer.pointer, format)
        }

        const rotation =
          rotationOf != null
            ? rotationOf(frame)
            : (ROTATION[frame.orientation] ?? 0)
        const key = `${rotation}:${frame.isMirrored}:${frame.width}x${frame.height}`
        if (posted.value !== key) {
          posted.value = key
          scheduleOnRN(
            onPosture,
            rotation,
            frame.isMirrored,
            frame.width,
            frame.height
          )
        }

        onEachFrame?.(frame)
      } finally {
        buffer?.release()
        frame.dispose()
      }
    },
    [
      handle,
      posted,
      onImage,
      onPosture,
      onEachFrame,
      formatOf,
      rotationOf,
      scheduleOnRN,
    ]
  )

  useEffect(() => {
    return () => {
      // An external entry is never evicted, so an undisposed handle leaks for the process's life.
      handle.value?.dispose()
      handle.value = null
    }
  }, [handle])

  return { image, posture, onFrame }
}
