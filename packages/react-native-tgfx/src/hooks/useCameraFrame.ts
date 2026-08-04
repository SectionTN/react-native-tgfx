import { useCallback, useEffect, useState } from 'react'
import type { UInt64 } from 'react-native-nitro-modules'
import { isModuleNotFound } from '../reanimated/moduleNotFound'
import type { PixelFormat, TgfxImage } from '../specs/TgfxImage.nitro'
import type { SharedValueLike } from '../types'
import { imageFromNativeBuffer } from './useImage'

let installed = true
let useSharedValue: (<T>(initial: T) => SharedValueLike<T>) | undefined
let scheduleOnRN:
  | (<A extends unknown[]>(fn: (...a: A) => void, ...args: A) => void)
  | undefined
try {
  // A require inside a try is what makes Reanimated optional to Metro; a static import never is.
  ;({ useSharedValue } = require('react-native-reanimated'))
  // Worklets is a hard peer of Reanimated, so it resolves whenever that did; a
  // miss here names *it*, fails the check below, and is rethrown as the broken
  // install it is.
  ;({ scheduleOnRN } = require('react-native-worklets'))
} catch (e) {
  if (!isModuleNotFound(e, 'react-native-reanimated')) {
    throw e
  }
  installed = false
}
if (installed && (useSharedValue == null || scheduleOnRN == null)) {
  throw new Error(
    '[tgfx] react-native-reanimated is installed but does not export useSharedValue, or react-native-worklets does not export scheduleOnRN, which useCameraFrame needs.'
  )
}

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
  /** Clockwise degrees that cancel `frame.orientation`. */
  rotation: number
  mirror: boolean
  width: number
  height: number
}

export interface CameraFrameSource<F extends FrameLike = FrameLike> {
  /** The handle to give `<CameraFrame>`, `null` until the first frame lands. */
  image: TgfxImage | null
  /** Spread onto `<CameraFrame>`; `width`/`height` are 0 before frame one. */
  posture: CameraFramePosture
  /** A worklet. Give it to the producer, e.g. `useFrameOutput({ onFrame })`. */
  onFrame: (frame: F) => void
}

/** `frame.orientation` to the clockwise rotation that cancels it. */
const ROTATION: Record<string, 0 | 90 | 180 | 270> = {
  up: 0,
  right: 270,
  down: 180,
  left: 90,
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
  onEachFrame?: (frame: F) => void
): CameraFrameSource<F> {
  if (!installed) {
    throw new Error(
      '[tgfx] useCameraFrame needs react-native-reanimated, which is not installed.'
    )
  }
  const [image, setImage] = useState<TgfxImage | null>(null)
  const [posture, setPosture] = useState<CameraFramePosture>(UPRIGHT)
  // Worklet-runtime state: read and written where the frames arrive, never here.
  const handle = useSharedValue!<TgfxImage | null>(null)
  const posted = useSharedValue!('')

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
      // Acquired *inside* the try: everything that can throw has to be, or a
      // throw skips the dispose() below and stalls the producer's bounded pool.
      let buffer: NativeBufferLike | null = null
      try {
        buffer = frame.getNativeBuffer()
        // Read the range off the frame rather than hardcoding it: a device
        // reporting `yuv-420-8-bit-full` imported as limited crushes the blacks.
        const format: PixelFormat = frame.pixelFormat.endsWith('-full')
          ? 'bt601-full'
          : 'bt601-limited'
        if (handle.value == null) {
          handle.value = imageFromNativeBuffer(buffer.pointer, format)
          scheduleOnRN!(onImage, handle.value)
        } else {
          handle.value.setNativeBuffer(buffer.pointer, format)
        }

        const rotation = ROTATION[frame.orientation] ?? 0
        const key = `${rotation}:${frame.isMirrored}:${frame.width}x${frame.height}`
        if (posted.value !== key) {
          posted.value = key
          scheduleOnRN!(
            onPosture,
            rotation,
            frame.isMirrored,
            frame.width,
            frame.height
          )
        }

        onEachFrame?.(frame)
      } finally {
        // The handle took its own reference, so the producer's slot is free the
        // moment this returns.
        buffer?.release()
        frame.dispose()
      }
    },
    [handle, posted, onImage, onPosture, onEachFrame]
  )

  useEffect(() => {
    return () => {
      // An external registry entry is never evicted, so an undisposed handle
      // leaks the texture and the hardware buffer it retains for the life of
      // the process. A frame still in flight lands on a stale handle, which
      // native logs and ignores.
      handle.value?.dispose()
      handle.value = null
    }
  }, [handle])

  return { image, posture, onFrame }
}
