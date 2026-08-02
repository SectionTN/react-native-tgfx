import { useCallback } from 'react'
import type { MaybeSharedValue } from '../compiler/values'
import { isModuleNotFound } from '../reanimated/moduleNotFound'

interface Frame {
  timeSinceFirstFrame: number
}

let installed = true
let useSharedValue: ((initial: number) => MaybeSharedValue<number>) | undefined
let useFrameCallback: ((cb: (frame: Frame) => void) => unknown) | undefined
try {
  // A require inside a try is what makes Reanimated optional to Metro; a static import never is.
  ;({ useSharedValue, useFrameCallback } = require('react-native-reanimated'))
} catch (e) {
  if (!isModuleNotFound(e, 'react-native-reanimated')) {
    throw e
  }
  installed = false
}
if (installed && (useSharedValue == null || useFrameCallback == null)) {
  throw new Error(
    '[tgfx] react-native-reanimated is installed but does not export useSharedValue/useFrameCallback, which useClock needs.'
  )
}

/**
 * Milliseconds since the first frame, as a SharedValue.
 *
 * Written on the UI thread, so feeding it to a shader uniform animates without
 * re-encoding the scene from JS. The tgfx counterpart of Skia's `useClock`.
 */
export function useClock(): MaybeSharedValue<number> {
  if (!installed) {
    throw new Error(
      '[tgfx] useClock needs react-native-reanimated, which is not installed.'
    )
  }
  const clock = useSharedValue!(0)
  // Stable identity: Reanimated keys its effect on the callback, so a fresh one
  // each render re-registers the frame callback and resets the clock to zero.
  const tick = useCallback(
    (frame: Frame) => {
      'worklet'
      clock.value = frame.timeSinceFirstFrame
    },
    [clock]
  )
  useFrameCallback!(tick)
  return clock
}
