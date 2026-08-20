import { useEffect } from 'react'
import type { SharedValueLike } from '../compiler/values'
import type { Viewport } from '../types'
import type { TgfxViewRef } from '../views/TgfxNativeView'
import { reanimatedInstalled, requireReanimated } from './peer'

/** A boxed native view, the capture of a HybridObject that survives a hop to another runtime. */
interface BoxedView {
  unbox(): TgfxViewRef
}

interface Nitro {
  NitroModules?: { box?: <T>(obj: T) => BoxedView }
}

let nitro: Nitro | null = null

function boxView(view: TgfxViewRef): BoxedView | null {
  if (nitro == null) {
    try {
      // A require inside a try is what keeps this optional to Metro.
      nitro = require('react-native-nitro-modules') as Nitro
    } catch {
      nitro = {}
    }
  }
  const modules = nitro.NitroModules
  if (modules?.box == null) {
    return null
  }
  try {
    // Through the proxy, not destructured: a bare `box` loses its `this`.
    return modules.box(view)
  } catch {
    return null
  }
}

/** This runtime's proxy for the view, cached on its global: unboxing costs a JSI call. */
function viewOf(boxed: BoxedView): TgfxViewRef {
  'worklet'
  const scope = globalThis as {
    __tgfxViewProxies?: WeakMap<BoxedView, TgfxViewRef>
  }
  let proxies = scope.__tgfxViewProxies
  if (proxies === undefined) {
    proxies = new WeakMap<BoxedView, TgfxViewRef>()
    scope.__tgfxViewProxies = proxies
  }
  let view = proxies.get(boxed)
  if (view === undefined) {
    view = boxed.unbox()
    proxies.set(boxed, view)
  }
  return view
}

interface DriverProps {
  view: TgfxViewRef
  viewport: SharedValueLike<Viewport>
}

/**
 * Pushes a SharedValue `<Canvas viewport>` to the native view from the UI
 * thread: a gesture worklet writes the shared value and the frame moves with
 * no JS-thread hop. The same defaults as the plain prop — a missing or
 * non-finite field falls back rather than reaching native, which would reject
 * the triple whole and strand the other two.
 */
function Driver({ view, viewport }: DriverProps): null {
  const mod = requireReanimated('the viewport driver', [
    'startMapper',
    'stopMapper',
  ])
  const start = mod.startMapper!
  const stop = mod.stopMapper!
  useEffect(() => {
    const boxed = boxView(view)
    if (boxed == null) {
      return
    }
    // Written in place per tick, so a gesture costs no allocation.
    const triple: number[] = [1, 0, 0]
    const mapperId = start(() => {
      'worklet'
      const at = viewport.value
      const zoom =
        typeof at?.zoom === 'number' && Number.isFinite(at.zoom) ? at.zoom : 1
      triple[0] = zoom > 0 ? zoom : 1
      triple[1] = typeof at?.x === 'number' && Number.isFinite(at.x) ? at.x : 0
      triple[2] = typeof at?.y === 'number' && Number.isFinite(at.y) ? at.y : 0
      // Optional: a JS bundle newer than the native binary lacks the method.
      viewOf(boxed).setViewport?.(triple)
    }, [viewport])
    return () => stop(mapperId)
  }, [view, viewport, start, stop])
  return null
}

/** Null when react-native-reanimated is not installed. */
export const ViewportDriver: ((props: DriverProps) => null) | null =
  reanimatedInstalled() ? Driver : null
