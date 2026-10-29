import type { HybridObject } from 'react-native-nitro-modules'

/**
 * A node handle's bookkeeping, in native memory every runtime can read.
 *
 * A handle has to answer one question on every write - "does the mounted
 * program keep a value slot for this key?" - and it has to answer it on
 * whichever runtime the write came from: the JS thread, the UI thread, or a
 * camera frame processor.
 *
 * Keeping that answer in a Reanimated `SharedValue` cannot do it. A shared
 * value is hosted by one runtime: a write from anywhere else is applied later
 * and does not update the writer's own copy, so the thread that published the
 * answer reads back the previous one; and a read from a third runtime is a
 * *blocking* call into the host, taken on the calling thread - 8 per frame in
 * the face-blur screen, on the camera thread.
 *
 * So the answer lives in bytes instead. {@link flags} wraps a native
 * allocation, and Nitro hands each runtime its own `ArrayBuffer` over the *same
 * memory* - no copy, no publish, no staleness. A write is a store, a read is an
 * index, and every runtime sees the store immediately.
 *
 * One byte per key rather than one bit: a byte store is indivisible, so a
 * reader can never catch a half-written value, and no reader-writer lock is
 * needed for what is a single writer (the compiler, on the JS thread) and many
 * readers.
 */
export interface TgfxSlots extends HybridObject<{
  ios: 'c++'
  android: 'c++'
}> {
  /**
   * The flag bytes, as a view onto the native allocation. Reading this from a
   * second runtime yields a *different* `ArrayBuffer` object over the *same*
   * memory, so each runtime should take it once and keep it.
   */
  readonly flags: ArrayBuffer
  /**
   * The value slots, `Float64` bytes over the same kind of shared native
   * allocation as {@link flags}. An aligned 8-byte store is indivisible on the
   * platforms this runs on, so a write from one runtime is a plain store and a
   * read from another is a plain load - no serialization, no allocation, no
   * lock. This is what lets a handle write from the JS thread without paying
   * the per-write worklet-serialization cost that a `SharedValue` write there
   * costs (native heap garbage the runtime's GC has no pressure to collect).
   */
  readonly values: ArrayBuffer
  /** String slot `at`, empty until first written. */
  getString(at: number): string
  /** Write string slot `at`; the previous value is freed on replacement. */
  setString(at: number, value: string): void
}

export interface TgfxSlotsFactory extends HybridObject<{
  ios: 'c++'
  android: 'c++'
}> {
  /**
   * A zeroed block of `size` flag bytes, `valueCount` doubles and
   * `stringCount` string slots, owned by the returned object.
   */
  create(size: number, valueCount: number, stringCount: number): TgfxSlots
}
