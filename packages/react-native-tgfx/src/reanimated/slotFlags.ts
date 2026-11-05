'worklet'

import type { TgfxSlots, TgfxSlotsFactory } from '../specs/TgfxSlots.nitro'

/** A boxed `TgfxSlots`, the form that survives a hop to another runtime. */
export interface BoxedSlots {
  unbox(): TgfxSlots
}

export interface FlagBlock {
  bytes: Uint8Array
  values: Float64Array
  slots: TgfxSlots
  boxed: BoxedSlots
}

interface Nitro {
  NitroModules?: {
    createHybridObject?: <T>(name: string) => T
    box?: <T>(obj: T) => BoxedSlots
  }
}

const cache = { nitro: null as Nitro | null }

function nitro(): Nitro {
  if (cache.nitro == null) {
    try {
      // A require inside a try is what keeps this optional to Metro.
      cache.nitro = require('react-native-nitro-modules') as Nitro
    } catch {
      cache.nitro = {}
    }
  }
  return cache.nitro
}

/**
 * `size` flag bytes plus `valueCount` value slots and `stringCount` string
 * slots, or null when the native module is unavailable - a test runner, or a
 * build without the native side linked.
 */
export function makeFlagBlock(
  size: number,
  valueCount = 0,
  stringCount = 0
): FlagBlock | null {
  const modules = nitro().NitroModules
  if (modules?.createHybridObject == null || modules.box == null) {
    return null
  }
  try {
    const factory =
      modules.createHybridObject<TgfxSlotsFactory>('TgfxSlotsFactory')
    const slots = factory.create(size, valueCount, stringCount)
    return {
      bytes: new Uint8Array(slots.flags),
      values: new Float64Array(slots.values),
      slots,
      boxed: modules.box(slots),
    }
  } catch {
    return null
  }
}

/** A view or surface that can copy a value block natively instead of taking an array. */
export interface BlockTarget {
  bindValues?(values: ArrayBuffer): void
  pushValues?(): boolean
}

/** Has `target` copy `block`, binding it when it holds another or a recycle dropped it; null if it cannot. */
export function pushBlock(
  target: BlockTarget,
  block: FlagBlock,
  bound: FlagBlock | null
): FlagBlock | null {
  if (target.pushValues == null || target.bindValues == null) {
    return null
  }
  const buffer = block.values.buffer as ArrayBuffer
  if (bound !== block) {
    target.bindValues(buffer)
  }
  if (target.pushValues() === false) {
    target.bindValues(buffer)
    target.pushValues()
  }
  return block
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

/** This runtime's `Float64` view of the block's value slots, cached like {@link flagsOf}. */
export function valuesOf(boxed: BoxedSlots): Float64Array<ArrayBuffer> {
  'worklet'
  const scope = globalThis as {
    __tgfxValueViews?: WeakMap<BoxedSlots, Float64Array<ArrayBuffer>>
  }
  let views = scope.__tgfxValueViews
  if (views === undefined) {
    views = new WeakMap<BoxedSlots, Float64Array<ArrayBuffer>>()
    scope.__tgfxValueViews = views
  }
  let view = views.get(boxed)
  if (view === undefined) {
    view = new Float64Array(boxed.unbox().values)
    views.set(boxed, view)
  }
  return view
}

/** This runtime's unboxed slots object, for the string get/set methods. */
export function slotsOf(boxed: BoxedSlots): TgfxSlots {
  'worklet'
  const scope = globalThis as {
    __tgfxSlotObjs?: WeakMap<BoxedSlots, TgfxSlots>
  }
  let objs = scope.__tgfxSlotObjs
  if (objs === undefined) {
    objs = new WeakMap<BoxedSlots, TgfxSlots>()
    scope.__tgfxSlotObjs = objs
  }
  let obj = objs.get(boxed)
  if (obj === undefined) {
    obj = boxed.unbox()
    objs.set(boxed, obj)
  }
  return obj
}
