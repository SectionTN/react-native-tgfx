import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
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

/**
 * A fully-defaulted readback request. The JS `Canvas` handle fills every field
 * before it reaches the bridge, so neither native side has to model absence —
 * see `nativeOptions` in `src/components/Canvas.tsx` for the defaults.
 *
 * `x`/`y`/`width`/`height` are logical pixels (dp), matching scene
 * coordinates; a `width` or `height` of 0 means "the whole canvas".
 */
export interface NativeSnapshotOptions {
  /** `'png' | 'jpeg' | 'webp' | 'raw'`; anything else is treated as `'png'`. */
  format: string
  quality: number
  x: number
  y: number
  width: number
  height: number
  scale: number
}

export interface NativeSnapshot {
  /** Encoded image bytes, or straight-alpha RGBA8888 rows for `format: 'raw'`. */
  data: ArrayBuffer
  width: number
  height: number
  format: string
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
   * Update the scene's string slots — live `text` and `path` content. Sparse:
   * `indices[i]` names the slot `values[i]` replaces, and only changed slots are
   * sent, so an idle frame costs nothing here. The engine re-shapes text or
   * re-parses path data on the render thread; the program is never re-read.
   */
  setStringValues(indices: number[], values: string[]): void

  /**
   * The drawing surface's colour space. `'display-p3'` on a P3 screen keeps
   * wide-gamut image and gradient content instead of clamping it to sRGB.
   */
  setColorSpace(colorSpace: string): void

  /**
   * Index paths of the nodes under a canvas-space point, front-to-back,
   * flattened as `[depth, i0, i1, ..., depth, j0, ...]`.
   *
   * Answered from the same resolved geometry the renderer draws, so it follows
   * animated values rather than the last committed props.
   */
  hitTest(x: number, y: number, precise: boolean): number[]

  /**
   * Read the canvas back as pixels.
   *
   * The readback is issued on the render thread inside the frame it belongs to,
   * so a snapshot forces one fresh frame and never blocks the display link: the
   * GPU→CPU transfer is collected on a later tick, and the encode runs on a
   * worker so the (process-wide, on Android) render thread goes straight back
   * to drawing.
   *
   * Rejects rather than handing back a black frame when no window is bound, the
   * surface is zero-sized, or the view is unmounted before the frame lands.
   */
  snapshot(options: NativeSnapshotOptions): Promise<NativeSnapshot>

  /**
   * The same readback, encoded and written to `path` natively — the image bytes
   * never enter JS, which is the entire reason this is not `snapshot()` plus a
   * file write.
   */
  save(path: string, options: NativeSnapshotOptions): Promise<void>
}

export type TgfxView = HybridView<TgfxViewProps, TgfxViewMethods>
