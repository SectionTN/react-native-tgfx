import type { HybridObject } from 'react-native-nitro-modules'

/**
 * A block of floats shared between JS and the renderer, for bulk per-frame data
 * — atlas sprites and mesh vertices — where per-slot patching would mean
 * thousands of slots.
 *
 * The allocation is native and registered under {@link id}; the draw program
 * carries the id, and the renderer reads the floats directly at draw. JS (or a
 * worklet — the `ArrayBuffer` maps the same memory on every runtime) writes
 * into a `Float32Array` view, so a frame of sprite updates is a run of float
 * stores: no marshalling, no allocation, no re-encode.
 *
 * One writer at a time. The renderer may read while JS writes — a sprite can
 * straddle a frame — so publish a consistent frame by writing data first and
 * the node's `count` slot last.
 */
export interface TgfxBuffer extends HybridObject<{
  ios: 'c++'
  android: 'c++'
}> {
  /** The registry id the draw program refers to this allocation by. */
  readonly id: number

  /** How many floats the allocation holds. */
  readonly size: number

  /**
   * The floats, as a view onto the native allocation. Reading this from a
   * second runtime yields a different `ArrayBuffer` over the same memory.
   */
  readonly buffer: ArrayBuffer
}

export interface TgfxBufferFactory extends HybridObject<{
  ios: 'c++'
  android: 'c++'
}> {
  /** A zeroed block of `size` floats, owned by the returned object. */
  create(size: number): TgfxBuffer
}
