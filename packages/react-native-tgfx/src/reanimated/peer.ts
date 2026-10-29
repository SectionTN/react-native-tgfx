import type { MaybeSharedValue } from '../compiler/values'
import { isModuleNotFound } from './moduleNotFound'

interface Frame {
  timeSinceFirstFrame: number
}

/** The Reanimated bindings this package uses. Each is absent when it is not installed. */
export interface Reanimated {
  makeMutable?: <T>(value: T) => MaybeSharedValue<T>
  runOnJS?: <A extends unknown[]>(
    fn: (...args: A) => void
  ) => (...args: A) => void
  startMapper?: (worklet: () => void, deps: unknown[]) => number
  stopMapper?: (id: number) => void
  useSharedValue?: <T>(initial: T) => MaybeSharedValue<T>
  useFrameCallback?: (cb: (frame: Frame) => void) => unknown
}

export interface Synchronizable<T> {
  getBlocking(): T
  setBlocking(value: T): void
}

export interface Worklets {
  scheduleOnRN?: <A extends unknown[]>(
    fn: (...a: A) => void,
    ...args: A
  ) => void
  scheduleOnUI?: (worklet: () => void) => void
  createSynchronizable?: <T>(initial: T) => Synchronizable<T>
}

/**
 * Reanimated, if it is installed, resolved on use.
 *
 * On use rather than at import, because this module is reachable from the
 * compiler, and the compiler must not drag an optional peer dependency - and
 * React Native itself behind it - into the graph of anything that only wants to
 * build a scene. The module object itself is not cached: `require` already is.
 *
 * A worklet. The absence cache is a const-object property, not a module `let`:
 * a worklet body assigning a captured `let` compiles to an assignment to a
 * `const` and fails to parse.
 */
const cache = { absent: null as boolean | null }

export function reanimated(): Reanimated {
  'worklet'
  // A worklet runtime has no `require`: report Reanimated absent rather than
  // crashing, so callers degrade the same way they do without the install.
  if (typeof require !== 'function') {
    return {}
  }
  if (cache.absent === true) {
    return {}
  }
  try {
    // A require inside a try is what makes Reanimated optional to Metro; a static import never is.
    return require('react-native-reanimated') as Reanimated
  } catch (e) {
    if (!isModuleNotFound(e, 'react-native-reanimated')) {
      throw e
    }
    cache.absent = true
    return {}
  }
}

/** True when react-native-reanimated resolves at all, whatever it exports. */
export function reanimatedInstalled(): boolean {
  if (cache.absent == null) {
    try {
      require('react-native-reanimated')
      cache.absent = false
    } catch (e) {
      if (!isModuleNotFound(e, 'react-native-reanimated')) {
        throw e
      }
      cache.absent = true
    }
  }
  return !cache.absent
}

/**
 * Throw naming the bindings `feature` needs, rather than at module scope: these
 * are not public Reanimated API, so a rename must take down the one feature that
 * uses them and not every import of this package.
 */
export function requireReanimated(
  feature: string,
  names: (keyof Reanimated)[]
): Reanimated {
  const mod = reanimated()
  if (!reanimatedInstalled()) {
    throw new Error(
      `[tgfx] ${feature} needs react-native-reanimated, which is not installed.`
    )
  }
  const gone = names.filter((name) => mod[name] == null)
  if (gone.length > 0) {
    throw new Error(
      `[tgfx] react-native-reanimated is installed but does not export ${gone.join(
        '/'
      )}, which ${feature} needs.`
    )
  }
  return mod
}

/**
 * react-native-worklets, a hard peer of Reanimated - so it resolves whenever
 * Reanimated did, and a miss here is a broken install rather than an absent
 * optional peer. Call only behind `requireReanimated`.
 */
export function worklets(): Worklets {
  return require('react-native-worklets') as Worklets
}
