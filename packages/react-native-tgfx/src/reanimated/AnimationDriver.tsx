import { useAnimatedReaction } from 'react-native-reanimated'
import type { MaybeSharedValue } from '../compiler/values'
import type { TgfxViewRef } from '../views/TgfxNativeView'

/**
 * The first-class Reanimated UI-thread driver.
 *
 * Each frame, a worklet reads the current value of every SharedValue backing the
 * scene's `{ __s }` slots and calls `view.setValues(...)` — a Nitro method.
 * Because nitro auto-installs worklets support (boxing/unboxing HybridObjects
 * across runtimes), this executes the native update directly on the UI thread
 * with **zero JS-thread work per frame**; the native render loop then redraws.
 *
 * Rendered (returning `null`) only when reanimated is installed and the scene has
 * at least one animated value — so reanimated stays an optional peer dependency.
 */
export function AnimationDriver({
  view,
  values,
}: {
  view: TgfxViewRef
  values: MaybeSharedValue<unknown>[]
}): null {
  useAnimatedReaction(
    () => {
      'worklet'
      return values.map((v) => Number(v.value))
    },
    (current) => {
      'worklet'
      view.setValues(current)
    },
    [view, values]
  )
  return null
}
