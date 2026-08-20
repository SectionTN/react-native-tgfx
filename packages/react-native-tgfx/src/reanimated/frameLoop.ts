// A UI-thread frame loop with no hook: what createClock and createVideoPlayer
// pump with, the way useFrameCallback pumps the hook forms.
import { requireReanimated, worklets } from './peer'

/**
 * Run `tick` (a worklet) once per UI-thread frame until the returned stop is
 * called. Timestamps are the UI runtime's `requestAnimationFrame` milliseconds
 * — the same clock `useFrameCallback` rides.
 */
export function startUiFrameLoop(
  what: string,
  tick: (timestampMs: number) => void
): () => void {
  const mod = requireReanimated(what, ['makeMutable'])
  const scheduleOnUI = worklets().scheduleOnUI
  if (scheduleOnUI == null) {
    throw new Error(
      `[tgfx] react-native-worklets does not export scheduleOnUI, which ${what} needs.`
    )
  }
  const running = mod.makeMutable!(true)
  scheduleOnUI(() => {
    'worklet'
    const raf = (
      globalThis as {
        requestAnimationFrame?: (cb: (t: number) => void) => void
      }
    ).requestAnimationFrame
    if (raf == null) {
      console.warn(
        `[tgfx] the UI runtime has no requestAnimationFrame, so ${what} never ticks.`
      )
      return
    }
    const loop = (t: number) => {
      if (running.value !== true) {
        return
      }
      tick(t)
      raf(loop)
    }
    raf(loop)
  })
  return () => {
    running.value = false
  }
}
