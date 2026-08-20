import { useCallback, useEffect, useMemo, useState } from 'react'
import type { UInt64 } from 'react-native-nitro-modules'
import {
  requireReanimated,
  worklets,
  type Synchronizable,
} from '../reanimated/peer'
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

/// Everything the per-frame worklet needs; one definition shared verbatim by
/// useCameraFrame (which recreates the closure when its deps move) and
/// createCameraFrameSink (which captures once).
interface FrameHandlerParts<F extends FrameLike> {
  handle: { value: TgfxImage | null }
  minted: Synchronizable<boolean>
  imageAcked: { value: boolean }
  postureAcked: { value: string }
  onImage: (h: TgfxImage) => void
  onPosture: (
    rotation: number,
    mirror: boolean,
    width: number,
    height: number
  ) => void
  onEachFrame?: (frame: F) => void
  formatOf?: (frame: F) => PixelFormat
  rotationOf?: (frame: F) => number
  scheduleOnRN: <A extends unknown[]>(fn: (...a: A) => void, ...args: A) => void
}

function handleCameraFrame<F extends FrameLike>(
  parts: FrameHandlerParts<F>,
  frame: F
): void {
  'worklet'
  const {
    handle,
    minted,
    imageAcked,
    postureAcked,
    onImage,
    onPosture,
    onEachFrame,
    formatOf,
    rotationOf,
    scheduleOnRN,
  } = parts
  // Acquired inside the try: a throw would skip the dispose() and stall the bounded pool.
  let buffer: NativeBufferLike | null = null
  try {
    buffer = frame.getNativeBuffer()
    // Read off the frame: `-full` imported as limited crushes the blacks.
    const format: PixelFormat =
      formatOf != null ? formatOf(frame) : defaultFormat(frame.pixelFormat)
    // The local `img`, never a `handle.value` read-back: the guest write is
    // asynchronous, so a read here can still be null after the mint.
    let img = handle.value
    if (img != null) {
      img.setNativeBuffer(buffer.pointer, format)
    } else if (!minted.getBlocking()) {
      img = imageFromNativeBuffer(buffer.pointer, format)
      minted.setBlocking(true)
      handle.value = img
    }
    if (img != null && !imageAcked.value) {
      scheduleOnRN(onImage, img)
    }

    const rotation =
      rotationOf != null
        ? rotationOf(frame)
        : (ROTATION[frame.orientation] ?? 0)
    const key = `${rotation}:${frame.isMirrored}:${frame.width}x${frame.height}`
    if (postureAcked.value !== key) {
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
}

/** {@link createCameraFrameSink}'s result: the handle, the posture, the pump. */
export interface CameraFrameSink<F extends FrameLike = FrameLike> {
  /** `null` until the first frame mints the handle. */
  readonly image: TgfxImage | null
  readonly posture: CameraFramePosture
  /** Feed a frame in — a worklet, callable from the producer's frame thread. */
  push: (frame: F) => void
  /** Dispose the minted handle; an external registry entry is never evicted. */
  dispose(): void
}

export interface CameraFrameSinkOptions<
  F extends FrameLike = FrameLike,
> extends CameraFrameOptions<F> {
  /** Your own per-frame worklet — a detector, say. Runs inside the same try. */
  onEachFrame?: (frame: F) => void
  /** Called on the JS thread when the handle mints. */
  onImage?: (image: TgfxImage) => void
  /** Called on the JS thread when the posture changes. */
  onPosture?: (posture: CameraFramePosture) => void
}

/**
 * {@link useCameraFrame} with no React: an analyze/record pipeline needs no
 * on-screen canvas. The sink owns the buffer lifecycle exactly as the hook
 * does — mint once, `setNativeBuffer` per frame, re-post until acked — and its
 * `image`/`posture` fields update as frames arrive. Call `dispose()` when the
 * stream ends. Everything in the hook's remarks about frame lifetime applies
 * to `push` unchanged.
 */
export function createCameraFrameSink<F extends FrameLike = FrameLike>(
  options?: CameraFrameSinkOptions<F>
): CameraFrameSink<F> {
  const mod = requireReanimated('createCameraFrameSink', ['makeMutable'])
  const { scheduleOnRN, createSynchronizable } = worklets()
  if (scheduleOnRN == null || createSynchronizable == null) {
    throw new Error(
      '[tgfx] react-native-worklets does not export scheduleOnRN/createSynchronizable, which createCameraFrameSink needs.'
    )
  }
  const handle = mod.makeMutable!<TgfxImage | null>(null) as {
    value: TgfxImage | null
  }
  const minted = createSynchronizable(false)
  const imageAcked = mod.makeMutable!(false) as { value: boolean }
  const postureAcked = mod.makeMutable!('') as { value: string }

  const sink = {
    image: null as TgfxImage | null,
    posture: UPRIGHT,
  }
  let disposed = false
  const onImage = (h: TgfxImage) => {
    // An in-flight post can land after dispose; the handle it carries is dead.
    if (disposed) {
      return
    }
    imageAcked.value = true
    sink.image = h
    options?.onImage?.(h)
  }
  const onPosture = (
    rotation: number,
    mirror: boolean,
    width: number,
    height: number
  ) => {
    if (disposed) {
      return
    }
    postureAcked.value = `${rotation}:${mirror}:${width}x${height}`
    sink.posture = { rotation, mirror, width, height }
    options?.onPosture?.(sink.posture)
  }
  const parts: FrameHandlerParts<F> = {
    handle,
    minted,
    imageAcked,
    postureAcked,
    onImage,
    onPosture,
    onEachFrame: options?.onEachFrame,
    formatOf: options?.format,
    rotationOf: options?.rotation,
    scheduleOnRN,
  }
  const push = (frame: F) => {
    'worklet'
    handleCameraFrame(parts, frame)
  }
  return {
    get image() {
      return sink.image
    },
    get posture() {
      return sink.posture
    },
    push,
    dispose() {
      disposed = true
      // An external entry is never evicted, so an undisposed handle leaks for the process's life.
      handle.value?.dispose()
      handle.value = null
      sink.image = null
    },
  }
}

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
 * The first frame creates the handle. Every later frame imports the new native
 * buffer and replaces the registry entry behind that handle, so there is no
 * React render, reconciler commit or program recompile. `posture` only reaches
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
  const { scheduleOnRN, createSynchronizable } = worklets()
  if (scheduleOnRN == null || createSynchronizable == null) {
    throw new Error(
      '[tgfx] react-native-worklets does not export scheduleOnRN/createSynchronizable, which useCameraFrame needs.'
    )
  }
  // Destructured, or an inline `{}` at the call site would re-register every render.
  const formatOf = options?.format
  const rotationOf = options?.rotation
  const [image, setImage] = useState<TgfxImage | null>(null)
  const [posture, setPosture] = useState<CameraFramePosture>(UPRIGHT)
  const handle = mod.useSharedValue!<TgfxImage | null>(null)
  // Synchronous, unlike the shared value: a guest-runtime write to `handle`
  // lands asynchronously, so this flag is what proves the mint happened.
  const minted = useMemo(
    () => createSynchronizable(false),
    [createSynchronizable]
  )
  // Written back from the React side: a cross-runtime post can be lost, and a
  // fire-once post that never lands is a permanently black canvas — so the
  // worklet keeps re-posting each frame until the matching ack arrives.
  const imageAcked = mod.useSharedValue!(false)
  const postureAcked = mod.useSharedValue!('')

  const onImage = useCallback(
    (h: TgfxImage) => {
      imageAcked.value = true
      setImage(h)
    },
    [imageAcked]
  )
  const onPosture = useCallback(
    (rotation: number, mirror: boolean, width: number, height: number) => {
      postureAcked.value = `${rotation}:${mirror}:${width}x${height}`
      setPosture((p) =>
        p.rotation === rotation &&
        p.mirror === mirror &&
        p.width === width &&
        p.height === height
          ? p
          : { rotation, mirror, width, height }
      )
    },
    [postureAcked]
  )

  // Memoised so the per-frame worklet allocates nothing, exactly as the old
  // inline closure read captured values with zero per-frame work.
  const parts = useMemo<FrameHandlerParts<F>>(
    () => ({
      handle,
      minted,
      imageAcked,
      postureAcked,
      onImage,
      onPosture,
      onEachFrame,
      formatOf,
      rotationOf,
      scheduleOnRN,
    }),
    [
      handle,
      minted,
      imageAcked,
      postureAcked,
      onImage,
      onPosture,
      onEachFrame,
      formatOf,
      rotationOf,
      scheduleOnRN,
    ]
  )
  const onFrame = useCallback(
    (frame: F) => {
      'worklet'
      handleCameraFrame(parts, frame)
    },
    [parts]
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
