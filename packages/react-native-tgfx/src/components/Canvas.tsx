import React, {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { callback } from 'react-native-nitro-modules'
import {
  isSharedValue,
  type MaybeSharedValue,
  type SharedValueLike,
} from '../compiler/values'
import type { Color } from '../compiler/colors'
import { packStringTable } from '../compiler/writer'
import { Fill } from './drawings'
import { AnimationDriver } from '../reanimated/AnimationDriver'
import { ViewportDriver } from '../reanimated/ViewportDriver'
import { isLive } from '../reanimated/liveValue'
import { TgfxRoot } from '../reconciler/Reconciler'
import { directNodes } from '../reconciler/directNodes'
import { createNode, NodeType } from '../reconciler/types'
import type { NativeSnapshotOptions } from '../specs/TgfxView.nitro'
import type {
  HitTestResult,
  CanvasProps,
  Snapshot,
  SnapshotFormat,
  SnapshotOptions,
  Viewport,
} from '../types'
import { loadFonts, type FontSource } from '../hooks/useFonts'
import { TgfxNativeView, type TgfxViewRef } from '../views/TgfxNativeView'

let warnedNoDriver = false

/**
 * The `fonts` prop's gate: children are withheld until every face registers,
 * so text never flashes in the platform fallback. No prop — ready at once,
 * costing canvases without fonts nothing. A failed load warns and lets the
 * children through: fallback text beats a canvas that stays blank forever.
 */
/// Keys whose faces already registered: a remount with a known key is ready
/// synchronously — no withheld frame, no repeated font-file reads.
const settledFontKeys = new Set<string>()

function useFontsReady(families?: Record<string, FontSource[]>): boolean {
  const key = families == null ? '' : JSON.stringify(families)
  const [readyKey, setReadyKey] = useState('')
  useEffect(() => {
    if (families == null || settledFontKeys.has(key)) {
      return
    }
    let active = true
    loadFonts(families)
      .catch((e: unknown) => {
        console.warn('[tgfx] <Canvas fonts> failed to load:', e)
      })
      .then(() => {
        // Settled either way: registration is permanent, and a failed load
        // renders with the fallback rather than retrying per remount.
        settledFontKeys.add(key)
        if (active) {
          setReadyKey(key)
        }
      })
    return () => {
      active = false
    }
    // The serialized key stands in for the object, exactly as useFontsState does.
  }, [key])
  return key === '' || readyKey === key || settledFontKeys.has(key)
}

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

/// Render-phase scratch, so resolving the prop allocates nothing per commit.
const scratchViewport: [number, number, number] = [1, 0, 0]

/** A finite number, or `fallback`. Plain numbers only: see {@link Viewport}. */
function viewportNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * `[zoom, x, y]` with the defaults filled in, written into `into` so a gesture
 * costs no allocation. A non-positive or non-finite field falls back rather
 * than reaching native, which would reject the whole triple and silently strand
 * the other two.
 */
function resolveViewport(
  viewport: Viewport | undefined,
  into: [number, number, number]
): [number, number, number] {
  const zoom = viewportNumber(viewport?.zoom, 1)
  into[0] = zoom > 0 ? zoom : 1
  into[1] = viewportNumber(viewport?.x, 0)
  into[2] = viewportNumber(viewport?.y, 0)
  return into
}

function sameViewport(
  a: readonly [number, number, number],
  b: readonly [number, number, number]
): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
}

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
      if (
        entry != null &&
        !Array.isArray(entry) &&
        'backgroundColor' in entry
      ) {
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
  return typeof value === 'string' && value !== 'transparent'
    ? value
    : undefined
}

/**
 * The declarative tgfx canvas. Children (`<Rect>`, `<Circle>`, `<Path>`,
 * `<Image>`, `<Text>`, `<Group>`, ...) are reconciled into an immutable node
 * tree, compiled to a binary draw program (with live slots for any Reanimated
 * SharedValue props), and handed to the native GPU view. When the scene has
 * animated values, the animation driver pushes them on the UI thread.
 */
export function Canvas({
  children,
  style,
  composite = 'layer',
  opaque = false,
  colorSpace = 'srgb',
  viewport,
  fonts,
  ref,
}: CanvasProps): React.ReactElement {
  // Before anything reads `children`: the gate swaps them for null until the
  // requested faces are in, and everything downstream just sees no scene yet.
  const fontsReady = useFontsReady(fonts)
  const shown = fontsReady ? children : null
  const [values, setValues] = useState<MaybeSharedValue<unknown>[]>([])
  const [stringValues, setStringValues] = useState<MaybeSharedValue<string>[]>(
    []
  )
  const [view, setView] = useState<TgfxViewRef | null>(null)
  const rootRef = useRef<TgfxRoot | null>(null)
  const viewRef = useRef<TgfxViewRef | null>(null)
  const scene = useRef<{ buffer: ArrayBuffer; strings: string[] } | null>(null)
  const prevValues = useRef<MaybeSharedValue<unknown>[]>([])
  const prevStringValues = useRef<MaybeSharedValue<string>[]>([])
  const sentStrings = useRef<string[]>([])
  const hybridRef = useRef<ReturnType<
    typeof callback<(ref: TgfxViewRef) => void>
  > | null>(null)

  if (hybridRef.current == null) {
    hybridRef.current = callback((ref: TgfxViewRef) => {
      viewRef.current = ref
      // Optional: a JS bundle newer than the native binary would otherwise throw here.
      ref.setColorSpace?.(colorSpaceRef.current)
      // Unconditional: a recycled view resets its viewport in clearScene(), but
      // both platforms defer that to detach to avoid a flash, so this side
      // cannot know whether it has landed yet. Native ignores an unchanged
      // triple, so the cost is one call on a frame the canvas is drawing anyway.
      const [zoom, x, y] = viewportRef.current
      sentViewport.current = [zoom, x, y]
      ref.setViewport?.([zoom, x, y])
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
  // Read through a ref: the hybrid callback is created once and must see the latest.
  // Three separate triples: `viewport` is what the canvas is at, `prop` is what
  // the last commit asked for, `sent` is what native was told. Folding the prop
  // into `viewport` on every render would revert an imperative write the moment
  // anything else re-rendered, and the effect — keyed on the prop's fields —
  // would not notice.
  const viewportRef = useRef<[number, number, number]>([1, 0, 0])
  const propViewport = useRef<[number, number, number]>([1, 0, 0])
  const sentViewport = useRef<[number, number, number]>([1, 0, 0])
  // A SharedValue viewport is pushed by the UI-thread driver below; the
  // plain-prop machinery here must then stay at identity and not fight it.
  const liveViewport = isSharedValue(viewport)
    ? (viewport as SharedValueLike<Viewport>)
    : null
  const nextProp = resolveViewport(
    liveViewport == null ? (viewport as Viewport | undefined) : undefined,
    scratchViewport
  )
  if (!sameViewport(nextProp, propViewport.current)) {
    propViewport.current = [nextProp[0], nextProp[1], nextProp[2]]
    viewportRef.current = [nextProp[0], nextProp[1], nextProp[2]]
  }
  const colorSpaceRef = useRef(colorSpace)
  const mountedColorSpace = useRef(colorSpace)
  colorSpaceRef.current = colorSpace
  useEffect(() => {
    if (
      colorSpace !== mountedColorSpace.current &&
      typeof __DEV__ !== 'undefined' &&
      __DEV__
    ) {
      console.warn(
        `[tgfx] <Canvas colorSpace> changed from '${mountedColorSpace.current}' to '${colorSpace}', which has no effect: the drawing surface takes its colour space from the platform window, and that is fixed when the canvas mounts. Remount the canvas with a key to change it.`
      )
    }
  }, [colorSpace])

  // One native write, no scene re-encode: the transform sits above the program.
  useEffect(() => {
    const at = viewportRef.current
    if (sameViewport(at, sentViewport.current)) {
      return
    }
    sentViewport.current = [at[0], at[1], at[2]]
    viewRef.current?.setViewport?.(at)
    // The resolved triple, not the prop's fields: a SharedValue viewport keeps
    // this identity and is pushed by the driver instead.
  }, [view, nextProp[0], nextProp[1], nextProp[2]])

  if (rootRef.current == null) {
    // Straight to the hybrid object: as a prop it would ride a React and a Fabric commit per frame.
    rootRef.current = new TgfxRoot((buffer, strings, vals, stringVals) => {
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
      if (!sameValueSet(prevStringValues.current, stringVals)) {
        prevStringValues.current = stringVals.slice()
        setStringValues(prevStringValues.current)
      }
    })
    rootRef.current.container.onValues = (vals) =>
      viewRef.current?.setValues(vals)
    rootRef.current.container.onStrings = (indices, vals) =>
      viewRef.current?.setStringValues?.(indices, vals)
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
      setViewport: (next: Viewport): void => {
        // In place, into the triple the bridge reads: a gesture calls this every
        // tick and AGENTS.md allows no per-frame allocation on that path.
        const at = viewportRef.current
        const zoom = viewportNumber(next.zoom, at[0])
        at[0] = zoom > 0 ? zoom : at[0]
        at[1] = viewportNumber(next.x, at[1])
        at[2] = viewportNumber(next.y, at[2])
        if (sameViewport(at, sentViewport.current)) {
          return
        }
        sentViewport.current = [at[0], at[1], at[2]]
        viewRef.current?.setViewport?.(at)
      },
      hitTest: (x, y, options): HitTestResult[] => {
        const view = viewRef.current
        const root = rootRef.current
        if (view == null || root == null) {
          return []
        }
        const flat = view.hitTest(x, y, options?.precise === true)
        const named = root.container.byPath
        const out: HitTestResult[] = []
        for (let i = 0; i < flat.length; ) {
          const depth = flat[i]!
          const path = flat.slice(i + 1, i + 1 + depth)
          i += 1 + depth
          out.push({ node: named.get(path.join(',')) ?? null, path })
        }
        return out
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
        shown
      ) : (
        <>
          <Fill color={background as Color} />
          {shown}
        </>
      ),
    [shown, background]
  )

  useEffect(() => {
    const root = rootRef.current
    if (root == null) {
      return
    }
    // Prepended to the built nodes, not to the elements: a wrapping fragment would
    // push every scene down `directNodes`' splice path.
    const direct = directNodes(shown)
    if (direct !== null) {
      if (background !== undefined) {
        direct.unshift(createNode(NodeType.Fill, { color: background }))
      }
      root.setDirect(direct)
      return
    }
    root.render(<>{scened}</>)
  }, [shown, background, scened])

  useEffect(() => {
    return () => {
      rootRef.current?.unmount()
    }
  }, [])

  // Slots this package writes need no driver, so they are not evidence Reanimated is missing.
  if (
    AnimationDriver == null &&
    !warnedNoDriver &&
    (liveViewport != null ||
      values.some((value) => !isLive(value)) ||
      stringValues.some((value) => !isLive(value)))
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
      {AnimationDriver != null &&
      view != null &&
      (values.length > 0 || stringValues.length > 0) ? (
        <AnimationDriver view={view} values={values} strings={stringValues} />
      ) : null}
      {ViewportDriver != null && view != null && liveViewport != null ? (
        <ViewportDriver view={view} viewport={liveViewport} />
      ) : null}
    </>
  )
}
