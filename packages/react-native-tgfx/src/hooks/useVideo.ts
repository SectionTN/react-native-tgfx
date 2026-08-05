import { useCallback, useEffect, useMemo, useState } from 'react'
import { Image as RNImage } from 'react-native'
import { NitroModules } from 'react-native-nitro-modules'
import type { MaybeSharedValue } from '../compiler/values'
import { requireReanimated, worklets } from '../reanimated/peer'
import type { TgfxImage } from '../specs/TgfxImage.nitro'
import type { TgfxVideo, TgfxVideoFactory } from '../specs/TgfxVideo.nitro'
import { imageFromNativeBuffer } from './useImage'

let factory: TgfxVideoFactory | null = null
function videos(): TgfxVideoFactory {
  factory ??=
    NitroModules.createHybridObject<TgfxVideoFactory>('TgfxVideoFactory')
  return factory
}

function videoUri(source: number | string): string {
  if (typeof source !== 'number') {
    return source
  }
  const resolved = RNImage.resolveAssetSource(source)
  if (resolved?.uri == null) {
    throw new Error(`could not resolve asset source: ${String(source)}`)
  }
  return resolved.uri
}

/**
 * Open a video outside React. The caller owns the player and must `release()`
 * it; {@link useVideo} does that for you.
 */
export function loadVideo(source: number | string): Promise<TgfxVideo> {
  return videos().load(videoUri(source))
}

export interface VideoOptions {
  /** Jump to this position, in milliseconds. Seeks again whenever it changes. */
  seek?: number | null
  /** Defaults to `false`, so a video plays as soon as it is open. */
  paused?: boolean
  looping?: boolean
  /** 0 to 1. Defaults to 0 — a canvas video is usually decoration, not media. */
  volume?: number
}

export interface Video {
  /**
   * The newest decoded frame, `null` until the first one lands. Feed it to
   * `<Image>`, or to `<CameraFrame>` when {@link rotation} is not 0.
   */
  readonly currentFrame: TgfxImage | null
  /** Playback position in milliseconds, written on the UI thread every frame. */
  readonly currentTime: MaybeSharedValue<number>
  /** Total length in milliseconds. 0 until the video is open. */
  readonly duration: number
  readonly framerate: number
  /** Clockwise degrees the frame must be rotated by to be upright. */
  readonly rotation: number
  /** The decoded frame's size, before {@link rotation} is applied. */
  readonly size: { width: number; height: number }
}

const EMPTY_SIZE = Object.freeze({ width: 0, height: 0 })

/**
 * Play a video into a native image handle.
 *
 * ```tsx
 * const { currentFrame, size } = useVideo(require('./clip.mp4'), { looping: true })
 * // ...
 * <Image image={currentFrame} x={0} y={0} width={size.width} height={size.height} />
 * ```
 *
 * Decoding is the platform's — AVPlayer on iOS, MediaPlayer on Android — so
 * audio, seeking and looping come from the player rather than from this package,
 * and every frame reaches the GPU as the hardware buffer it decoded into. No
 * pixels cross into JS, and no React render happens per frame: the first frame
 * creates the handle and every later one re-points it, which is a pointer swap
 * that schedules a redraw on its own.
 *
 * Frames are pulled on the UI thread, so a busy JS thread does not stall
 * playback. That is what needs react-native-reanimated here.
 *
 * The player is released, and the handle disposed, when `source` changes or the
 * component unmounts — a device has only a handful of hardware decoders.
 *
 * @remarks
 * Android needs API 29 or newer: below it there is no way to get a frame out of
 * the decoder without a CPU copy, and `load` rejects rather than doing one
 * silently.
 */
export function useVideo(
  source: number | string,
  options?: VideoOptions
): Video {
  const mod = requireReanimated('useVideo', [
    'useSharedValue',
    'useFrameCallback',
  ])
  const scheduleOnRN = worklets().scheduleOnRN
  if (scheduleOnRN == null) {
    throw new Error(
      '[tgfx] react-native-worklets does not export scheduleOnRN, which useVideo needs.'
    )
  }
  const { seek, paused = false, looping = false, volume = 0 } = options ?? {}

  const [video, setVideo] = useState<TgfxVideo | null>(null)
  const [currentFrame, setCurrentFrame] = useState<TgfxImage | null>(null)
  const currentTime = mod.useSharedValue!(0)
  const player = mod.useSharedValue!<TgfxVideo | null>(null)
  const handle = mod.useSharedValue!<TgfxImage | null>(null)

  const onImage = useCallback((image: TgfxImage) => {
    setCurrentFrame(image)
  }, [])

  useEffect(() => {
    let active = true
    setVideo(null)
    setCurrentFrame(null)
    let opened: TgfxVideo | null = null

    // Deferred: an unresolvable asset throws synchronously, and inside an effect that is a crash.
    Promise.resolve()
      .then(() => videos().load(videoUri(source)))
      .then((loaded) => {
        if (!active) {
          loaded.release()
          return
        }
        opened = loaded
        player.value = loaded
        setVideo(loaded)
      })
      .catch((e: unknown) => {
        if (!active) {
          return
        }
        console.warn('[tgfx] useVideo failed to open:', e)
      })

    return () => {
      active = false
      player.value = null
      // Handle first: releasing the player closes the buffer the handle still points at.
      handle.value?.dispose()
      handle.value = null
      // A player left to the GC keeps a hardware decoder, of which a device has a handful.
      opened?.release()
    }
  }, [source, player, handle])

  useEffect(() => {
    if (video != null) {
      video.paused = paused
    }
  }, [video, paused])

  useEffect(() => {
    if (video != null) {
      video.looping = looping
    }
  }, [video, looping])

  useEffect(() => {
    if (video != null) {
      video.volume = volume
    }
  }, [video, volume])

  useEffect(() => {
    if (video != null && seek != null) {
      video.seek(seek)
    }
  }, [video, seek])

  const tick = useCallback(() => {
    'worklet'
    const current = player.value
    if (current == null) {
      return
    }
    // 0 means "nothing decoded since the last call" — the frame stays as it is.
    const buffer = current.acquireFrame()
    if (buffer) {
      if (handle.value == null) {
        handle.value = imageFromNativeBuffer(buffer, current.pixelFormat)
        scheduleOnRN(onImage, handle.value)
      } else {
        handle.value.setNativeBuffer(buffer, current.pixelFormat)
      }
    }
    currentTime.value = current.currentTime
  }, [player, handle, currentTime, onImage, scheduleOnRN])

  mod.useFrameCallback!(tick)

  const size = useMemo(
    () =>
      video == null
        ? EMPTY_SIZE
        : { width: video.width, height: video.height },
    [video]
  )

  return {
    currentFrame,
    currentTime,
    duration: video?.duration ?? 0,
    framerate: video?.framerate ?? 0,
    rotation: video?.rotation ?? 0,
    size,
  }
}
