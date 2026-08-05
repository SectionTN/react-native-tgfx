import type { HybridObject, UInt64 } from 'react-native-nitro-modules'
import type { PixelFormat } from './TgfxImage.nitro'

/**
 * A decoding video, driven by the platform player — AVPlayer on iOS,
 * MediaPlayer on Android — so audio, looping and seeking cost this package no
 * decoder of its own.
 *
 * Frames leave here as raw hardware buffers rather than as images: the caller
 * feeds one to a {@link TgfxImage} handle, which is the same zero-copy path a
 * camera frame takes. Nothing about a frame ever reaches JS as pixels.
 */
export interface TgfxVideo
  extends HybridObject<{
    ios: 'swift'
    android: 'kotlin'
  }> {
  /** Total length in milliseconds, 0 when the source does not report one. */
  readonly duration: number
  readonly framerate: number
  /** Clockwise degrees the buffer must be rotated by to be upright. */
  readonly rotation: number
  readonly width: number
  readonly height: number
  /** How the decoder's planes map to RGB — read off the track, not assumed. */
  readonly pixelFormat: PixelFormat
  /** Playback position in milliseconds. */
  readonly currentTime: number

  paused: boolean
  looping: boolean
  /** 0 to 1. */
  volume: number

  seek(millis: number): void

  /**
   * The newest decoded frame as a hardware buffer pointer — an
   * `AHardwareBuffer*` on Android, a `CVPixelBufferRef` on iOS — or 0 when no
   * new frame has been decoded since the last call.
   *
   * The buffer stays retained until the *next* call, which is long enough to
   * hand it to `TgfxImage.setNativeBuffer`, and that takes its own reference.
   * Never store the pointer: after the next call it is somebody else's memory.
   */
  acquireFrame(): UInt64

  /**
   * Stop playback and free the decoder and its buffers now, rather than at the
   * next GC. A player left to a finalizer holds a hardware decoder — a device
   * has a handful of those, so a screen that opens videos runs out.
   */
  release(): void
}

export interface TgfxVideoFactory
  extends HybridObject<{
    ios: 'swift'
    android: 'kotlin'
  }> {
  /** A `file://`, `http(s)://`, `content://` or `asset://` URI, or a bare path. */
  load(uri: string): Promise<TgfxVideo>
}
