import { useEffect } from 'react'
import type { MaybeSharedValue } from '../compiler/values'
import type { TgfxViewRef } from '../views/TgfxNativeView'
import { isBlockSlot, readLiveNumber, readLiveString } from './liveValue'
import { reanimatedInstalled, requireReanimated } from './peer'
import { flagsOf, valuesOf, type BoxedSlots } from './slotFlags'

interface DriverProps {
  view: TgfxViewRef
  values: MaybeSharedValue<unknown>[]
  strings: MaybeSharedValue<string>[]
  /** Per-handle wake values: block slots have no listeners, these do. */
  gens: MaybeSharedValue<unknown>[]
  /** Where each push is mirrored for the next commit; see TgfxContainer.mirror. */
  mirror: BoxedSlots | null
}

function Driver({ view, values, strings, gens, mirror }: DriverProps): null {
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
    // Set once this mapper has bound its mirror, from the thread that writes it.
    const bound = [false]
    // A block slot cannot be a mapper input; the handle's gen stands in for it.
    const listenable = [...values, ...strings].filter((v) => !isBlockSlot(v))
    for (const gen of gens) {
      listenable.push(gen)
    }
    if (listenable.length === 0) {
      return
    }
    const mapperId = start(() => {
      'worklet'
      const mirrored = mirror != null ? valuesOf(mirror) : null
      // The view copies the mirror natively, so no array is marshalled. Optional: an older binary lacks it.
      const direct = mirrored != null && view.pushValues != null
      for (let i = 0; i < values.length; i++) {
        const v = readLiveNumber(values[i]!)
        if (!direct) {
          slots[i] = v
        }
        if (mirrored != null) {
          mirrored[i] = v
        }
      }
      if (mirror != null) {
        flagsOf(mirror)[0] = 1
      }
      if (direct) {
        if (!bound[0]) {
          view.bindValues(mirrored.buffer)
          bound[0] = true
        }
        view.pushValues()
      } else {
        view.setValues(slots)
      }
      if (strings.length > 0) {
        let indices: number[] | null = null
        let out: string[] | null = null
        for (let i = 0; i < strings.length; i++) {
          const now = readLiveString(strings[i]!)
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
    }, listenable)
    return () => stop(mapperId)
  }, [view, values, strings, gens, mirror, start, stop])
  return null
}

/** Null when react-native-reanimated is not installed. */
export const AnimationDriver: ((props: DriverProps) => null) | null =
  reanimatedInstalled() ? Driver : null
