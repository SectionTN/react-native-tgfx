import { useEffect } from 'react'
import type { MaybeSharedValue } from '../compiler/values'
import type { TgfxViewRef } from '../views/TgfxNativeView'
import { reanimatedInstalled, requireReanimated } from './peer'

interface DriverProps {
  view: TgfxViewRef
  values: MaybeSharedValue<unknown>[]
}

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
