import React, { useEffect, useImperativeHandle, useRef, useState } from 'react'
import { callback } from 'react-native-nitro-modules'
import type { MaybeSharedValue } from '../compiler/values'
import { packStringTable } from '../compiler/writer'
import { AnimationDriver } from '../reanimated/AnimationDriver'
import { TgfxRoot } from '../reconciler/Reconciler'
import { directNodes } from '../reconciler/directNodes'
import type { NativeSnapshotOptions } from '../specs/TgfxView.nitro'
import type {
  CanvasProps,
  Snapshot,
  SnapshotFormat,
  SnapshotOptions,
} from '../types'
import { TgfxNativeView, type TgfxViewRef } from '../views/TgfxNativeView'

let warnedNoDriver = false

/** Fill in every field, so neither native side has to model an absent option. */
function nativeOptions(options: SnapshotOptions = {}): NativeSnapshotOptions {
  const rect = options.rect
  return {
    format: options.format ?? 'png',
    // Documented as 1–100; an out-of-range value reaches ImageCodec::Encode raw.
    quality: Math.min(100, Math.max(1, Math.round(options.quality ?? 100))),
    x: rect?.x ?? 0,
    y: rect?.y ?? 0,
    width: rect?.width ?? 0,
    height: rect?.height ?? 0,
    scale: options.scale ?? 1,
  }
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
  ref,
}: CanvasProps): React.ReactElement {
  const [values, setValues] = useState<MaybeSharedValue<unknown>[]>([])
  const [view, setView] = useState<TgfxViewRef | null>(null)
  const rootRef = useRef<TgfxRoot | null>(null)
  const viewRef = useRef<TgfxViewRef | null>(null)
  const scene = useRef<{ buffer: ArrayBuffer; strings: string[] } | null>(null)
  const prevValues = useRef<MaybeSharedValue<unknown>[]>([])
  // The string table this view already holds, so commits send only the delta.
  const sentStrings = useRef<string[]>([])
  const hybridRef = useRef<ReturnType<
    typeof callback<(ref: TgfxViewRef) => void>
  > | null>(null)

  // `useRef(callback(...))` would wrap a fresh Nitro callback on every render.
  if (hybridRef.current == null) {
    hybridRef.current = callback((ref: TgfxViewRef) => {
      viewRef.current = ref
      sentStrings.current = []
      // Commits can land before the native view exists; flush the latest scene.
      if (scene.current != null) {
        const strings = scene.current.strings
        ref.setScene(scene.current.buffer, packStringTable([], strings))
        sentStrings.current = strings.slice()
      }
      setView(ref)
    })
  }
  const hybrid = hybridRef.current

  if (rootRef.current == null) {
    // The program goes straight to the hybrid object: as a prop it would ride a
    // React re-render plus a Fabric shadow-tree commit on every frame.
    rootRef.current = new TgfxRoot((buffer, strings, vals) => {
      scene.current = { buffer, strings }
      if (viewRef.current != null) {
        viewRef.current.setScene(
          buffer,
          packStringTable(sentStrings.current, strings)
        )
        sentStrings.current = strings.slice()
      }
      // The Reanimated mapper must re-subscribe when the value set changes —
      // but only then, not on every reconciler commit.
      if (!sameValueSet(prevValues.current, vals)) {
        prevValues.current = vals.slice()
        setValues(prevValues.current)
      }
    })
  }

  useImperativeHandle(
    ref,
    () => ({
      snapshot: async (options?: SnapshotOptions): Promise<Snapshot> => {
        const view = viewRef.current
        if (view == null) {
          throw new Error('[tgfx] snapshot: the canvas is not mounted yet')
        }
        const snap = await view.snapshot(nativeOptions(options))
        return { ...snap, format: snap.format as SnapshotFormat }
      },
      save: async (path: string, options?: SnapshotOptions): Promise<void> => {
        const view = viewRef.current
        if (view == null) {
          throw new Error('[tgfx] save: the canvas is not mounted yet')
        }
        await view.save(path, nativeOptions(options))
      },
    }),
    []
  )

  useEffect(() => {
    const root = rootRef.current
    if (root == null) {
      return
    }
    // Plain shape trees need none of the reconciler's machinery, and mounting a
    // fiber per node is the JS thread's largest cost on an animated scene.
    // Anything it cannot handle returns null and takes the reconciler as before.
    const direct = directNodes(children)
    if (direct !== null) {
      root.setDirect(direct)
      return
    }
    root.render(<>{children}</>)
  }, [children])

  // Not nulled: the render body that builds it never re-runs on a StrictMode remount.
  useEffect(() => {
    return () => {
      rootRef.current?.unmount()
    }
  }, [])

  if (AnimationDriver == null && values.length > 0 && !warnedNoDriver) {
    warnedNoDriver = true
    console.warn(
      '[tgfx] SharedValue props need react-native-reanimated, which is not installed: they stay frozen at their last committed value.'
    )
  }

  return (
    <>
      <TgfxNativeView
        inHierarchy={composite === 'texture'}
        opaque={opaque}
        style={style}
        hybridRef={hybrid}
      />
      {AnimationDriver != null && view != null && values.length > 0 ? (
        <AnimationDriver view={view} values={values} />
      ) : null}
    </>
  )
}
