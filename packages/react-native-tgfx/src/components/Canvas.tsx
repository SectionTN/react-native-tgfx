import React, {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { callback } from 'react-native-nitro-modules'
import type { MaybeSharedValue } from '../compiler/values'
import type { Color } from '../compiler/colors'
import { packStringTable } from '../compiler/writer'
import { Fill } from './drawings'
import { AnimationDriver } from '../reanimated/AnimationDriver'
import { isLive } from '../reanimated/liveValue'
import { TgfxRoot } from '../reconciler/Reconciler'
import { directNodes } from '../reconciler/directNodes'
import { createNode, NodeType } from '../reconciler/types'
import type { NativeSnapshotOptions } from '../specs/TgfxView.nitro'
import type {
  CanvasProps,
  Snapshot,
  SnapshotFormat,
  SnapshotOptions,
} from '../types'
import { TgfxNativeView, type TgfxViewRef } from '../views/TgfxNativeView'

let warnedNoDriver = false

function nativeOptions(options: SnapshotOptions = {}): NativeSnapshotOptions {
  const rect = options.rect
  const scale = options.scale ?? 1
  // Rejected rather than clamped: natively this surfaces as a GPU allocation failure.
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error(
      `[tgfx] snapshot: scale must be a positive finite number, got ${String(
        options.scale
      )}`
    )
  }
  if (
    rect != null &&
    !(
      Number.isFinite(rect.x) &&
      Number.isFinite(rect.y) &&
      Number.isFinite(rect.width) &&
      Number.isFinite(rect.height)
    )
  ) {
    throw new Error('[tgfx] snapshot: rect must have four finite numbers')
  }
  return {
    format: options.format ?? 'png',
    // Documented as 1–100; an out-of-range value reaches ImageCodec::Encode raw.
    quality: Math.min(100, Math.max(1, Math.round(options.quality ?? 100))),
    x: rect?.x ?? 0,
    y: rect?.y ?? 0,
    width: rect?.width ?? 0,
    height: rect?.height ?? 0,
    scale,
  }
}

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

const NO_VIEW_BACKGROUND = { backgroundColor: 'transparent' } as const

/**
 * The last `backgroundColor` in a possibly nested style, or undefined. Flattened
 * here rather than through `StyleSheet` so the component pulls in no runtime.
 *
 * Only a string is taken. A `PlatformColor()` is an opaque object the scene
 * cannot encode, and a bare number is `0xRRGGBBAA` to React Native but
 * `0xAARRGGBB` to `<Fill>` — both are left to the platform view instead of
 * being guessed at.
 */
function backgroundOf(style: unknown): string | undefined {
  if (Array.isArray(style)) {
    // Last wins, and an entry that names the key at all settles it — even as undefined.
    for (let i = style.length - 1; i >= 0; i--) {
      const entry = style[i] as Record<string, unknown> | null | undefined
      if (entry != null && !Array.isArray(entry) && 'backgroundColor' in entry) {
        return backgroundOf(entry)
      }
      if (Array.isArray(entry)) {
        const found = backgroundOf(entry)
        if (found !== undefined) {
          return found
        }
      }
    }
    return undefined
  }
  const value = (style as { backgroundColor?: unknown } | null | undefined)
    ?.backgroundColor
  return typeof value === 'string' && value !== 'transparent' ? value : undefined
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
  const sentStrings = useRef<string[]>([])
  const hybridRef = useRef<ReturnType<
    typeof callback<(ref: TgfxViewRef) => void>
  > | null>(null)

  if (hybridRef.current == null) {
    hybridRef.current = callback((ref: TgfxViewRef) => {
      viewRef.current = ref
      sentStrings.current = []
      if (scene.current != null) {
        const strings = scene.current.strings
        ref.setScene(scene.current.buffer, packStringTable([], strings))
        sentStrings.current = strings.slice()
        // A write before the view existed only moved its slot; the program carries the literals.
        rootRef.current?.container.pushValues()
      }
      setView(ref)
    })
  }
  const hybrid = hybridRef.current

  if (rootRef.current == null) {
    // Straight to the hybrid object: as a prop it would ride a React and a Fabric commit per frame.
    rootRef.current = new TgfxRoot((buffer, strings, vals) => {
      scene.current = { buffer, strings }
      if (viewRef.current != null) {
        viewRef.current.setScene(
          buffer,
          packStringTable(sentStrings.current, strings)
        )
        sentStrings.current = strings.slice()
      }
      if (!sameValueSet(prevValues.current, vals)) {
        prevValues.current = vals.slice()
        setValues(prevValues.current)
      }
    })
    rootRef.current.container.onValues = (vals) =>
      viewRef.current?.setValues(vals)
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
      redraw: (): void => {
        viewRef.current?.invalidate()
      },
    }),
    []
  )

  // A SurfaceView punches a hole through the window, so the view's own
  // backgroundColor can never show behind the canvas. Draw it instead, and
  // clear it on the view so the two can never composite twice.
  const background = backgroundOf(style)
  const viewStyle = useMemo(
    () => (background === undefined ? style : [style, NO_VIEW_BACKGROUND]),
    [style, background]
  )
  const scened = useMemo(
    () =>
      background === undefined ? (
        children
      ) : (
        <>
          <Fill color={background as Color} />
          {children}
        </>
      ),
    [children, background]
  )

  useEffect(() => {
    const root = rootRef.current
    if (root == null) {
      return
    }
    // Prepended to the built nodes, not to the elements: a wrapping fragment would
    // push every scene down `directNodes`' splice path.
    const direct = directNodes(children)
    if (direct !== null) {
      if (background !== undefined) {
        direct.unshift(createNode(NodeType.Fill, { color: background }))
      }
      root.setDirect(direct)
      return
    }
    root.render(<>{scened}</>)
  }, [children, background, scened])

  useEffect(() => {
    return () => {
      rootRef.current?.unmount()
    }
  }, [])

  // Slots this package writes need no driver, so they are not evidence Reanimated is missing.
  if (
    AnimationDriver == null &&
    !warnedNoDriver &&
    values.some((value) => !isLive(value))
  ) {
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
        style={viewStyle}
        hybridRef={hybrid}
      />
      {AnimationDriver != null && view != null && values.length > 0 ? (
        <AnimationDriver view={view} values={values} />
      ) : null}
    </>
  )
}
