import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
  UInt64,
} from 'react-native-nitro-modules'

/**
 * Props for the native tgfx canvas view.
 *
 * The declarative React tree (`<Canvas>` + `<Rect>` / `<Circle>` / `<Path>` /
 * `<Image>` / `<Text>` ...) is reconciled and compiled into a single JSON
 * "draw program" that is handed to the native side through {@link scene}. The
 * shared C++ engine parses it once per structural change and replays it through
 * tgfx on the platform's display-link / choreographer callback.
 */
export interface TgfxViewProps extends HybridViewProps {
  /** JSON-serialized draw program produced by the reconciler/compiler. */
  scene: string
}

export interface TgfxViewMethods extends HybridViewMethods {
  /** Request a repaint. */
  invalidate(): void

  /**
   * Update the scene's `{ "__s": index }` value slots. Called every frame from a
   * Reanimated worklet, so it runs natively on the UI thread.
   */
  setValues(values: number[]): void

  /**
   * Draw a camera frame, blurring the interior of each supplied contour.
   *
   * `buffer` is a platform hardware-buffer pointer (an `AHardwareBuffer*` on
   * Android, a `CVPixelBufferRef` on iOS) — pass `frame.getNativeBuffer().pointer`.
   * `contours` is a flat polygon list: for each shape, the point count followed
   * by that many `x, y` pairs, in frame pixel coordinates.
   *
   * The frame and the contours are mapped with the same transform, so the blur
   * cannot drift from the image.
   */
  drawCameraFrame(
    buffer: UInt64,
    frameWidth: number,
    frameHeight: number,
    contours: number[],
    blurRadius: number
  ): void
}

export type TgfxView = HybridView<TgfxViewProps, TgfxViewMethods>
