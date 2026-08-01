import { useEffect } from 'react'
import type { MaybeSharedValue } from '../compiler/values'
import type { TgfxViewRef } from '../views/TgfxNativeView'
import { isModuleNotFound } from './moduleNotFound'

interface DriverProps {
  view: TgfxViewRef
  values: MaybeSharedValue<unknown>[]
}

let installed = true
let startMapper: ((worklet: () => void, deps: unknown[]) => number) | undefined
let stopMapper: ((id: number) => void) | undefined
try {
  // A require inside a try is what makes Reanimated optional to Metro; a static import never is.
  ({ startMapper, stopMapper } = require('react-native-reanimated'))
} catch (e) {
  if (!isModuleNotFound(e, 'react-native-reanimated')) {
    throw e
  }
  installed = false
}
if (installed && (startMapper == null || stopMapper == null)) {
  throw new Error(
    '[tgfx] react-native-reanimated is installed but does not export startMapper/stopMapper, which the animation driver needs.'
  )
}

/**
 * The Reanimated UI-thread driver. A mapper worklet reads every SharedValue
 * backing the scene's `{ __s }` slots into a buffer allocated once and hands it
 * to the native renderer, so animation costs no JS-thread work per frame.
 *
 * `startMapper` rather than `useAnimatedReaction`: the latter writes its result
 * into a SharedValue every frame, which for an N-element array is a blocking
 * clone of N values per frame.
 */
function Driver({ view, values }: DriverProps): null {
  useEffect(() => {
    const slots = new Array<number>(values.length)
    const mapperId = startMapper!(() => {
      'worklet'
      for (let i = 0; i < values.length; i++) {
        slots[i] = Number(values[i]!.value)
      }
      view.setValues(slots)
    }, values)
    return () => stopMapper!(mapperId)
  }, [view, values])
  return null
}

/** Null when react-native-reanimated is not installed. */
export const AnimationDriver: ((props: DriverProps) => null) | null = installed
  ? Driver
  : null
