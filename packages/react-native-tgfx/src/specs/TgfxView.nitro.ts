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
   * `scene` is the binary program (the buffer behind a `Float64Array`).
   *
   * `strings` is **not** the string table — it is a delta against the table this
   * view already holds. Element 0 is the decimal count of leading entries the
   * view keeps; elements 1..n replace everything after them. The program indexes
   * the reconstructed table (path data, text, image sources, shader source), so
   * a caller driving this directly must encode with `packStringTable` from
   * `src/compiler/writer.ts` and track the table it last sent per view. Passing
   * a bare table drops entry 0 and misindexes everything after it.
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
   *
   * The buffer is retained for as long as the draw needs it, so the caller may
   * release its own reference as soon as this returns. A frame the renderer has
   * not drawn yet is superseded by the next one rather than queued behind it.
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
