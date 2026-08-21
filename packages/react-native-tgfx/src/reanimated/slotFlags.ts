'worklet'

import type { TgfxSlots, TgfxSlotsFactory } from '../specs/TgfxSlots.nitro'

/** A boxed `TgfxSlots`, the form that survives a hop to another runtime. */
export interface BoxedSlots {
  unbox(): TgfxSlots
}

export interface FlagBlock {
  bytes: Uint8Array
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
    return null
  }
}

/** This runtime's view of the block, cached on its global: unboxing costs a JSI call. */
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
