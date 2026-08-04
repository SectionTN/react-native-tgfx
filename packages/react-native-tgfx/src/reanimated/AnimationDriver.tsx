import { useEffect } from 'react'
import type { MaybeSharedValue } from '../compiler/values'
import type { TgfxViewRef } from '../views/TgfxNativeView'
import { reanimatedInstalled, requireReanimated } from './peer'

interface DriverProps {
  view: TgfxViewRef
  values: MaybeSharedValue<unknown>[]
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
  const mod = requireReanimated('the animation driver', [
    'startMapper',
    'stopMapper',
  ])
  const start = mod.startMapper!
  const stop = mod.stopMapper!
  useEffect(() => {
    const slots = new Array<number>(values.length)
    const mapperId = start(() => {
      'worklet'
      for (let i = 0; i < values.length; i++) {
        slots[i] = Number(values[i]!.value)
      }
      view.setValues(slots)
    }, values)
    return () => stop(mapperId)
  }, [view, values, start, stop])
  return null
}

/** Null when react-native-reanimated is not installed. */
export const AnimationDriver: ((props: DriverProps) => null) | null =
  reanimatedInstalled() ? Driver : null
