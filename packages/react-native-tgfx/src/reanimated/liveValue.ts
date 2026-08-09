import type { MaybeSharedValue } from '../compiler/values'
import { reanimated, type Reanimated } from './peer'

/** A value slot this package created, rather than one the caller animates. */
export type LiveValue = MaybeSharedValue<number>

// A set, not a property: `makeMutable` returns Reanimated's object, and branding it mutates a foreign one.
const LIVE = new WeakSet<object>()

/**
 * A value the compiled program can patch in place: it is written as a value slot
 * exactly like an animated prop, so writing it again costs one `setValues`
 * instead of a re-encode.
 *
 * A real SharedValue whenever Reanimated is installed, because it has to be
 * writable from the UI thread — both by the animation driver's mapper, which
 * copies a plain object over once and would then push the stale copy back every
 * frame, and by an imperative write inside a worklet.
 */
export function makeShared<T>(value: T): MaybeSharedValue<T> {
  const makeMutable = reanimated().makeMutable
  if (makeMutable != null) {
    return makeMutable(value)
  }
  return {
    value,
    _isReanimatedSharedValue: true,
  } as MaybeSharedValue<T>
}

export function makeLive(value: number): LiveValue {
  const live = makeShared(value)
  LIVE.add(live)
  return live
}

/** A live string slot: `text` and `path` content the engine patches in place. */
export type LiveString = MaybeSharedValue<string>

export function makeLiveString(value: string): LiveString {
  const live = makeShared(value)
  LIVE.add(live)
  return live
}

/** True for a value only this package writes, so no driver is needed for it. */
export function isLive(value: MaybeSharedValue<unknown>): boolean {
  return LIVE.has(value)
}

/**
 * Reanimated's own `runOnJS`, which is itself a worklet — so it can be captured
 * by one of ours and called on the UI thread. A wrapper around it could not: a
 * plain function reached from a worklet is a remote handle, and calling one on
 * the UI runtime throws.
 *
 * Undefined when Reanimated is absent, and never needed then: without it there
 * is no UI runtime to be on in the first place.
 */
export function getRunOnJS(): Reanimated['runOnJS'] {
  return reanimated().runOnJS
}
