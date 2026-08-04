import type { MaybeSharedValue } from '../compiler/values'
import { isModuleNotFound } from './moduleNotFound'

interface Reanimated {
  makeMutable?: <T>(value: T) => MaybeSharedValue<T>
  runOnJS?: <A extends unknown[]>(
    fn: (...args: A) => void
  ) => (...args: A) => void
}

let cached: Reanimated | null = null

/**
 * Reanimated, if it is installed, loaded on first use.
 *
 * Lazily, because this module is reachable from the compiler, and the compiler
 * must not drag an optional peer dependency — and React Native itself behind it
 * — into the graph of anything that only wants to build a scene.
 */
function reanimated(): Reanimated {
  if (cached == null) {
    try {
      // A require inside a try is what makes Reanimated optional to Metro; a static import never is.
      cached = require('react-native-reanimated') as Reanimated
    } catch (e) {
      if (!isModuleNotFound(e, 'react-native-reanimated')) {
        throw e
      }
      cached = {}
    }
  }
  return cached
}

/** Marks a value this package created, rather than one the caller animates. */
export interface LiveValue extends MaybeSharedValue<number> {
  _tgfxLive?: true
}

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
    _tgfxLive: true,
  } as MaybeSharedValue<T>
}

export function makeLive(value: number): LiveValue {
  return makeShared(value) as LiveValue
}

/** True for a value only this package writes, so no driver is needed for it. */
export function isLive(value: MaybeSharedValue<unknown>): boolean {
  return (value as LiveValue)._tgfxLive === true
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
