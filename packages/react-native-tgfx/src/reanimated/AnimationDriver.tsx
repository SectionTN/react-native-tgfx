import { useEffect } from 'react'
import type { MaybeSharedValue } from '../compiler/values'
import type { TgfxViewRef } from '../views/TgfxNativeView'
import { reanimatedInstalled, requireReanimated } from './peer'

interface DriverProps {
  view: TgfxViewRef
  values: MaybeSharedValue<unknown>[]
  strings: MaybeSharedValue<string>[]
}

function Driver({ view, values, strings }: DriverProps): null {
  const mod = requireReanimated('the animation driver', [
    'startMapper',
    'stopMapper',
  ])
  const start = mod.startMapper!
  const stop = mod.stopMapper!
  useEffect(() => {
    const slots = new Array<number>(values.length)
    // Last pushed per string slot: only changes cross, so an idle frame is free.
    const sent = new Array<string | null>(strings.length).fill(null)
    const mapperId = start(
      () => {
        'worklet'
        for (let i = 0; i < values.length; i++) {
          slots[i] = Number(values[i]!.value)
        }
        view.setValues(slots)
        if (strings.length > 0) {
          let indices: number[] | null = null
          let out: string[] | null = null
          for (let i = 0; i < strings.length; i++) {
            const now = String(strings[i]!.value ?? '')
            if (now === sent[i]) {
              continue
            }
            sent[i] = now
            ;(indices ??= []).push(i)
            ;(out ??= []).push(now)
          }
          if (indices != null && out != null) {
            // Optional: a JS bundle newer than the native binary lacks the method.
            view.setStringValues?.(indices, out)
          }
        }
      },
      strings.length > 0 ? [...values, ...strings] : values
    )
    return () => stop(mapperId)
  }, [view, values, strings, start, stop])
  return null
}

/** Null when react-native-reanimated is not installed. */
export const AnimationDriver: ((props: DriverProps) => null) | null =
  reanimatedInstalled() ? Driver : null
