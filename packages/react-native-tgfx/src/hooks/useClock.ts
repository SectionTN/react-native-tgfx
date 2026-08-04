import { useCallback } from 'react'
import type { MaybeSharedValue } from '../compiler/values'
import { requireReanimated } from '../reanimated/peer'

interface Frame {
  timeSinceFirstFrame: number
}

/**
 * Seconds since the first frame, as a SharedValue.
 *
 * Written on the UI thread, so feeding it to a shader uniform animates without
 * re-encoding the scene from JS.
 *
 * Seconds rather than milliseconds because the value is usually bound for a
 * shader uniform, and GLSL ES mediump floats stop being representable above
 * 65504: a millisecond clock turns every shader that reads it black after about
 * a minute of uptime, silently. Seconds buy eighteen hours instead.
 */
export function useClock(): MaybeSharedValue<number> {
  const mod = requireReanimated('useClock', [
    'useSharedValue',
    'useFrameCallback',
  ])
  const clock = mod.useSharedValue!(0)
  // Stable identity: Reanimated keys its effect on the callback, so a fresh one
  // each render re-registers the frame callback and resets the clock to zero.
  const tick = useCallback(
    (frame: Frame) => {
      'worklet'
      clock.value = frame.timeSinceFirstFrame / 1000
    },
    [clock]
  )
  mod.useFrameCallback!(tick)
  return clock
}
