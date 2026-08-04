/**
 * A handle's patchable-key flags, in native bytes every runtime can read.
 *
 * The compiler decides once per commit which keys the mounted program keeps a
 * value slot for, and every `set()` has to consult that answer — on whichever
 * runtime the write came from. A Reanimated `SharedValue` cannot serve it: the
 * value is hosted by one runtime, so publishing it from the JS thread is
 * asynchronous and reading it back there returns the previous commit's answer,
 * while reading it from a third runtime is a blocking call into the host.
 *
 * Nitro hands each runtime its own `ArrayBuffer` over the *same* native
 * allocation, so the answer is just bytes: the compiler stores, every runtime
 * loads, and there is nothing to publish and nothing to go stale.
 *
 * Optional, like Reanimated itself: without the native module every read
 * returns null and the caller falls back to the shared-value path.
 */
import type { TgfxSlots, TgfxSlotsFactory } from '../specs/TgfxSlots.nitro'

/** A boxed `TgfxSlots`, the form that survives a hop to another runtime. */
export interface BoxedSlots {
  unbox(): TgfxSlots
}

export interface FlagBlock {
  /** The JS thread's own view, for the compiler's stores. */
  bytes: Uint8Array
  /** What a worklet captures; unboxed once per runtime, then cached. */
  boxed: BoxedSlots
}

interface Nitro {
  NitroModules?: {
    createHybridObject?: <T>(name: string) => T
    box?: <T>(obj: T) => BoxedSlots
  }
}

let cached: Nitro | null = null

function nitro(): Nitro {
  if (cached == null) {
    try {
      // A require inside a try is what keeps this optional to Metro.
      cached = require('react-native-nitro-modules') as Nitro
    } catch {
      cached = {}
    }
  }
  return cached
}

/**
 * `size` flag bytes, or null when the native module is unavailable — a test
 * runner, or a build without the native side linked.
 */
export function makeFlagBlock(size: number): FlagBlock | null {
  const modules = nitro().NitroModules
  if (modules?.createHybridObject == null || modules.box == null) {
    return null
  }
  try {
    const factory =
      modules.createHybridObject<TgfxSlotsFactory>('TgfxSlotsFactory')
    const slots = factory.create(size)
    return {
      bytes: new Uint8Array(slots.flags),
      boxed: modules.box(slots),
    }
  } catch {
    // Registered by the native side; absent in a JS-only environment.
    return null
  }
}

/**
 * This runtime's view of the block, cached on its global object. Unboxing costs
 * a JSI call, so it happens once per runtime rather than once per write; the
 * bytes behind every view are the same memory either way.
 */
export function flagsOf(boxed: BoxedSlots): Uint8Array {
  'worklet'
  const scope = globalThis as {
    __tgfxFlagViews?: WeakMap<BoxedSlots, Uint8Array>
  }
  let views = scope.__tgfxFlagViews
  if (views === undefined) {
    views = new WeakMap<BoxedSlots, Uint8Array>()
    scope.__tgfxFlagViews = views
  }
  let view = views.get(boxed)
  if (view === undefined) {
    view = new Uint8Array(boxed.unbox().flags)
    views.set(boxed, view)
  }
  return view
}
