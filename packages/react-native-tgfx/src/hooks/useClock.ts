import { useCallback } from 'react'
import type { SharedValueLike } from '../compiler/values'
import { startUiFrameLoop } from '../reanimated/frameLoop'
import { requireReanimated } from '../reanimated/peer'

interface Frame {
  timeSinceFirstFrame: number
}

/** What {@link createClock} returns: the ticking value, and how to stop it. */
export interface Clock {
  value: SharedValueLike<number>
  stop(): void
}

/**
 * {@link useClock} with no React: seconds since creation as a SharedValue,
 * written on the UI thread, for driving a shader uniform on any target — a
 * canvas or an offscreen surface. Call `stop()` when done; the loop otherwise
 * runs for the process's life.
 *
 * Needs react-native-reanimated, exactly as the hook does: without a UI
 * runtime there is nothing to write the value.
 */
export function createClock(): Clock {
  const mod = requireReanimated('createClock', ['makeMutable'])
  const clock = mod.makeMutable!(0)
  const first = mod.makeMutable!(-1)
  const stop = startUiFrameLoop('createClock', (t) => {
    'worklet'
    if (first.value < 0) {
      first.value = t
    }
    // Seconds, not milliseconds: see useClock below — mediump floats.
    clock.value = (t - first.value) / 1000
  })
  return { value: clock as SharedValueLike<number>, stop }
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
export function useClock(): SharedValueLike<number> {
  const mod = requireReanimated('useClock', [
    'useSharedValue',
    'useFrameCallback',
  ])
  const clock = mod.useSharedValue!(0)
  // Stable identity: Reanimated keys its effect on the callback, so a fresh one resets the clock.
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
