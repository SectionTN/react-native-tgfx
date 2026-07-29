import { useEffect } from 'react'
import { startMapper, stopMapper } from 'react-native-reanimated'
import type { MaybeSharedValue } from '../compiler/values'
import type { TgfxViewRef } from '../views/TgfxNativeView'

/**
 * The Reanimated UI-thread driver. A mapper worklet reads every SharedValue
 * backing the scene's `{ __s }` slots into a buffer allocated once and hands it
 * to the native renderer, so animation costs no JS-thread work per frame.
 *
 * `startMapper` rather than `useAnimatedReaction`: the latter writes its result
 * into a SharedValue every frame, which for an N-element array is a blocking
 * clone of N values per frame.
 */
export function AnimationDriver({
  view,
  values,
}: {
  view: TgfxViewRef
  values: MaybeSharedValue<unknown>[]
}): null {
  useEffect(() => {
    const slots = new Array<number>(values.length)
    const mapperId = startMapper(() => {
      'worklet'
      for (let i = 0; i < values.length; i++) {
        slots[i] = Number(values[i]!.value)
      }
      view.setValues(slots)
    }, values)
    return () => stopMapper(mapperId)
  }, [view, values])
  return null
}
