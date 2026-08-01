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
 * `<Image>` / `<Text>` ...) is reconciled and compiled into a binary "draw
 * program" that is handed to the native side through
 * {@link TgfxViewMethods.setScene}. The shared C++ engine reads it once per
 * structural change and replays it through tgfx on the platform's display-link
 * / choreographer callback.
 */
export interface TgfxViewProps extends HybridViewProps {
  /**
   * Android composition mode: `true` draws the canvas inside the view hierarchy
   * (a TextureView) so transparency and transforms behave like any other view;
   * `false` gives it its own compositor layer, which is faster. Read once, when
   * the native view is created.
   */
  inHierarchy: boolean

  /**
   * Composite without an alpha channel, so the layer needs no blending and the
   * engine clears to opaque black instead of transparent.
   */
  opaque: boolean
}

export interface TgfxViewMethods extends HybridViewMethods {
  /**
   * Replace the draw program.
   *
   * `scene` is the binary program (the buffer behind a `Float64Array`) and
   * `strings` its string table — path data, text, image sources and shader
   * source, which the program references by index.
   *
   * A direct hybrid-object call rather than a view prop: the scene changes on
   * every reconciler commit, and a prop would push the whole program through a
   * React re-render and a Fabric shadow-tree commit before reaching the engine.
   * The buffer is only valid for the duration of the call; the engine copies it.
   */
  setScene(scene: ArrayBuffer, strings: string[]): void

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
