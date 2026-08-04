import type { HybridObject } from 'react-native-nitro-modules'
import type { CameraFrameOutput } from 'react-native-vision-camera'

/**
 * Routes a {@link CameraFrameOutput}'s frames into a tgfx image handle without
 * JS on the per-frame path.
 *
 * `useCameraFrame()` in `react-native-tgfx` does the same job in a worklet, and
 * is the right choice when the frame processor has JS work to do anyway (a
 * detector, a classifier). This is for the case where it does not: the frame
 * only has to reach the canvas, so it never enters a JS runtime at all.
 *
 * Both routes are the same zero-copy import — `Image::MakeFrom` over the
 * hardware buffer, sampled as YUV planes inside the fragment shader. The
 * difference is only who calls it.
 */
export interface TgfxCameraSink extends HybridObject<{
  ios: 'c++'
  android: 'c++'
}> {
  /**
   * Point `handle` at every frame `output` produces, from native code.
   *
   * `handle` is `TgfxImage.handle` for an image created from a native buffer —
   * so the caller still owns the handle's lifetime and still passes the same
   * `TgfxImage` to `<CameraFrame>`. Create it from the first frame in a worklet
   * (`imageFromNativeBuffer`), then call this; from that point the worklet is
   * replaced and no frame reaches JS.
   *
   * Installing the callback has to happen on the output's own thread, and
   * `NativeThread.runOnThread` only *defers* when it is called from JS — so
   * this call is asynchronous: it returns before the swap has happened, and the
   * JS callback keeps running until it does.
   *
   * The frame's colour range is read per frame from `Frame.pixelFormat`, not
   * assumed: importing full-range planes as limited-range crushes the blacks.
   *
   * A second `attach()` replaces the first. Calling it with a stale handle is
   * harmless — the registry rejects an unknown id and the frame is dropped.
   */
  attach(output: CameraFrameOutput, handle: number): void

  /**
   * Stop routing frames. Also asynchronous, for the same reason as
   * {@link attach}. Idempotent, and implied by disposing this object.
   */
  detach(): void

  /**
   * Frames handed to the registry since the last {@link attach}.
   *
   * Cheap enough to poll: it is a relaxed atomic read, and reading it from JS
   * costs the JS thread, not the camera thread. It exists so a benchmark can
   * prove frames are flowing without a per-frame callback that would put JS
   * back on the path it just left.
   */
  readonly frameCount: number
}
