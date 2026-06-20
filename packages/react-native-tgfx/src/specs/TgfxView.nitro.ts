import type {
  HybridView,
  HybridViewMethods,
  HybridViewProps,
} from 'react-native-nitro-modules'

/**
 * Props for the native tgfx canvas view.
 *
 * The declarative React tree (`<Canvas>` + `<Rect>` / `<Circle>` / `<Path>` /
 * `<Image>` / `<Text>` ...) is reconciled and compiled into a single JSON
 * "draw program" that is handed to the native side through {@link scene}. The
 * shared C++ engine parses it once per structural change and replays it through
 * tgfx on the platform's display-link / choreographer callback.
 *
 * Animated (Reanimated) values are not pushed through `scene` every frame —
 * they are written into a separate shared values buffer on the UI thread (see
 * {@link valuesBuffer}) and sampled natively, so animation costs zero JS work
 * per frame.
 */
export interface TgfxViewProps extends HybridViewProps {
  /** JSON-serialized draw program produced by the reconciler/compiler. */
  scene: string
  /**
   * Zero-copy buffer of `Float64` animation values, indexed by the value slots
   * referenced from {@link scene}. Written on the UI thread by the Reanimated
   * driver and read by the native render loop. `undefined` for fully static
   * scenes.
   */
  valuesBuffer?: ArrayBuffer
  /** Number of live value slots inside {@link valuesBuffer}. */
  valueCount?: number
}

export interface TgfxViewMethods extends HybridViewMethods {
  /**
   * Request an immediate repaint. Normally unnecessary — the native loop redraws
   * on prop changes and on every animation frame — but useful for imperative
   * one-off invalidation.
   */
  invalidate(): void

  /**
   * Update the live animation value slots referenced from {@link TgfxViewProps.scene}
   * (via `{ "__s": index }` placeholders). Designed to be called every frame from
   * a Reanimated worklet on the UI thread — because Nitro HybridObjects are
   * boxed/unboxed across runtimes, this executes natively on the UI thread with
   * zero JS-thread work per frame.
   */
  setValues(values: number[]): void
}

export type TgfxView = HybridView<TgfxViewProps, TgfxViewMethods>
