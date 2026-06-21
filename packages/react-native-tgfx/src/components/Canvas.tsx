import React, { useEffect, useRef, useState } from 'react'
import { callback } from 'react-native-nitro-modules'
import type { MaybeSharedValue } from '../compiler/values'
import { TgfxRoot } from '../reconciler/Reconciler'
import type { CanvasProps } from '../types'
import { TgfxNativeView, type TgfxViewRef } from '../views/TgfxNativeView'

const EMPTY_SCENE = '{"v":1,"root":{"t":"g","ch":[]}}'

// The Reanimated UI-thread driver is loaded lazily so react-native-reanimated
// stays an optional peer dependency (static scenes never need it).
type DriverComponent = React.ComponentType<{
  view: TgfxViewRef
  values: MaybeSharedValue<unknown>[]
}>
let AnimationDriver: DriverComponent | null = null
try {
  AnimationDriver = require('../reanimated/AnimationDriver').AnimationDriver
} catch {
  AnimationDriver = null
}

/** True when two SharedValue lists reference the same set in the same order. */
function sameValueSet(
  a: MaybeSharedValue<unknown>[],
  b: MaybeSharedValue<unknown>[]
): boolean {
  if (a.length !== b.length) {
    return false
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false
    }
  }
  return true
}

/**
 * The declarative tgfx canvas. Children (`<Rect>`, `<Circle>`, `<Path>`,
 * `<Image>`, `<Text>`, `<Group>`, ...) are reconciled into an immutable node
 * tree, compiled to a JSON draw-program (with `{ __s }` slots for any Reanimated
 * SharedValue props), and handed to the native GPU view. When the scene has
 * animated values, the {@link AnimationDriver} pushes them on the UI thread.
 */
export function Canvas({ children, style }: CanvasProps): React.ReactElement {
  const [scene, setScene] = useState<string>(EMPTY_SCENE)
  const [values, setValues] = useState<MaybeSharedValue<unknown>[]>([])
  const [view, setView] = useState<TgfxViewRef | null>(null)
  const rootRef = useRef<TgfxRoot | null>(null)
  const hybridRef = useRef(callback((ref: TgfxViewRef) => setView(ref)))
  const prevScene = useRef<string>(EMPTY_SCENE)
  const prevValues = useRef<MaybeSharedValue<unknown>[]>([])

  if (rootRef.current == null) {
    // Only push to state when the value actually changes, so the native view
    // and the Reanimated mapper aren't re-driven on every reconciler commit.
    rootRef.current = new TgfxRoot((json, vals) => {
      if (json !== prevScene.current) {
        prevScene.current = json
        setScene(json)
      }
      if (!sameValueSet(prevValues.current, vals)) {
        prevValues.current = vals
        setValues(vals)
      }
    })
  }

  useEffect(() => {
    rootRef.current?.render(<>{children}</>)
  }, [children])

  useEffect(() => {
    return () => {
      rootRef.current?.unmount()
      rootRef.current = null
    }
  }, [])

  return (
    <>
      <TgfxNativeView scene={scene} style={style} hybridRef={hybridRef.current} />
      {AnimationDriver != null && view != null && values.length > 0 ? (
        <AnimationDriver view={view} values={values} />
      ) : null}
    </>
  )
}
