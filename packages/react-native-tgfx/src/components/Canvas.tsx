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

  if (rootRef.current == null) {
    rootRef.current = new TgfxRoot((json, vals) => {
      setScene(json)
      setValues(vals)
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
