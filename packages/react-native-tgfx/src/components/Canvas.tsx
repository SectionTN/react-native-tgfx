import React, { useEffect, useRef, useState } from 'react'
import { callback } from 'react-native-nitro-modules'
import type { MaybeSharedValue } from '../compiler/values'
import { TgfxRoot } from '../reconciler/Reconciler'
import type { CanvasProps } from '../types'
import { TgfxNativeView, type TgfxViewRef } from '../views/TgfxNativeView'

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
 * tree, compiled to a binary draw program (with live slots for any Reanimated
 * SharedValue props), and handed to the native GPU view. When the scene has
 * animated values, the {@link AnimationDriver} pushes them on the UI thread.
 */
export function Canvas({
  children,
  style,
  composite = 'layer',
  opaque = false,
}: CanvasProps): React.ReactElement {
  const [values, setValues] = useState<MaybeSharedValue<unknown>[]>([])
  const [view, setView] = useState<TgfxViewRef | null>(null)
  const rootRef = useRef<TgfxRoot | null>(null)
  const viewRef = useRef<TgfxViewRef | null>(null)
  const scene = useRef<{ buffer: ArrayBuffer; strings: string[] } | null>(null)
  const prevValues = useRef<MaybeSharedValue<unknown>[]>([])
  const hybridRef = useRef(
    callback((ref: TgfxViewRef) => {
      viewRef.current = ref
      // Commits can land before the native view exists; flush the latest scene.
      if (scene.current != null) {
        ref.setScene(scene.current.buffer, scene.current.strings)
      }
      setView(ref)
    })
  )

  if (rootRef.current == null) {
    // The program goes straight to the hybrid object: as a prop it would ride a
    // React re-render plus a Fabric shadow-tree commit on every frame.
    rootRef.current = new TgfxRoot((buffer, strings, vals) => {
      scene.current = { buffer, strings }
      viewRef.current?.setScene(buffer, strings)
      // The Reanimated mapper must re-subscribe when the value set changes —
      // but only then, not on every reconciler commit.
      if (!sameValueSet(prevValues.current, vals)) {
        prevValues.current = vals.slice()
        setValues(prevValues.current)
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
      <TgfxNativeView
        inHierarchy={composite === 'texture'}
        opaque={opaque}
        style={style}
        hybridRef={hybridRef.current}
      />
      {AnimationDriver != null && view != null && values.length > 0 ? (
        <AnimationDriver view={view} values={values} />
      ) : null}
    </>
  )
}
