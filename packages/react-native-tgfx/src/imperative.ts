import { useRef } from 'react'
import type { MaybeSharedValue } from './compiler/values'
import type { SceneWriter } from './compiler/writer'
import {
  getRunOnJS,
  makeLive,
  makeShared,
  type LiveValue,
} from './reanimated/liveValue'
import type { Node } from './reconciler/types'

/**
 * Every prop the compiled program can patch in place — the same list as
 * "Which props animate" in the animation docs. A handled node gets a value slot
 * for each of these it carries, whether or not anything is ever written to it,
 * so a write never has to wait for a re-encode to take effect.
 */
const SLOT_PROPS = [
  'x',
  'y',
  'width',
  'height',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'x1',
  'y1',
  'x2',
  'y2',
  'strokeWidth',
  'opacity',
  'fontSize',
] as const

/**
 * What the container gives a bound handle: the two ways a mounted scene can be
 * changed without React. `pushValues` patches the slots the program already
 * has; `recompile` re-encodes it, which is what a prop with no slot costs.
 */
export interface NodeOwner {
  pushValues(): void
  recompile(): void
}

/**
 * A ref on a drawing node: changes a mounted node without a React render.
 *
 * ```tsx
 * const box = useNode()
 * <Rect ref={box} x={0} y={0} width={40} height={40} />
 * box.set({ x: 120 })
 * ```
 *
 * A prop the program keeps a value slot for (`x`, `y`, `width`, `height`, `cx`,
 * `cy`, `r`, `strokeWidth`, `opacity`, `fontSize`, ...) is patched in place: one
 * `setValues`, no re-encode, and it works **inside a worklet**, so a gesture can
 * drive it without ever waking the JS thread. Anything else (`path`, `text`,
 * `color`, `image`) re-encodes the scene — still with no React render, no
 * reconciler commit and no Fabric commit — and from a worklet it hops to the JS
 * thread to do it.
 *
 * **The next React commit wins.** An imperative write survives until the canvas
 * re-renders, and then the JSX props are the truth again. Drive a value from one
 * side or the other, not both.
 */
export interface NodeHandle {
  set(props: Record<string, unknown>): void
}

/** What the compiler and the container need; never visible to a worklet. */
interface Internals {
  apply(node: Node, reseed: boolean): Node
  bind(owner: NodeOwner, w: SceneWriter): void
}

// Off the handle itself: a worklet capturing the handle clones every own
// enumerable property, and these close over the scene graph.
const internals = new WeakMap<NodeHandle, Internals>()

export function isNodeHandle(value: unknown): value is NodeHandle {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { isTgfxNode?: unknown }).isTgfxNode === true
  )
}

export function nodeInternals(handle: NodeHandle): Internals {
  return internals.get(handle)!
}

function createHandle(): NodeHandle {
  // Resolved now, so the worklet below captures the function itself: looking it
  // up from inside the worklet would capture a remote handle instead.
  const runOnJS = getRunOnJS()
  // Created up front, all of them: a worklet captures this record by value, so a
  // slot added later would never be visible on the UI thread.
  const slots: Record<string, LiveValue> = {}
  for (const name of SLOT_PROPS) {
    slots[name] = makeLive(0)
  }
  // Which of those the *current* program actually patches. Plain booleans inside
  // a shared value, so a worklet can tell a patchable write from one that needs
  // the JS thread.
  const patchable: MaybeSharedValue<Record<string, boolean>> = makeShared({})

  /** Non-slot writes, applied over the JSX props at compile time. */
  const overrides: Record<string, unknown> = {}
  let owner: NodeOwner | null = null
  let dirty = false

  const applyOnJS = (props: Record<string, unknown>): void => {
    let recompile = false
    for (const key in props) {
      const value = props[key]
      const slot = slots[key]
      if (typeof value === 'number' && slot !== undefined) {
        slot.value = value
        if (patchable.value[key] === true) {
          continue
        }
        // No slot for it in the current program — either the element does not
        // carry the prop, or the compiler writes it as a literal (`Text`'s
        // `width`, an `opacity` that had to be folded into a product). Only a
        // fresh program carries the new value, every time.
        overrides[key] = slot
      } else if (overrides[key] !== value) {
        overrides[key] = value
      } else {
        continue
      }
      dirty = true
      recompile = true
    }
    if (owner == null) {
      // Not compiled yet; the overrides are in place for the first compile.
      return
    }
    if (recompile) {
      owner.recompile()
    } else {
      owner.pushValues()
    }
  }

  const pushOnJS = (): void => owner?.pushValues()

  const clearOverrides = (): void => {
    if (!dirty) {
      return
    }
    for (const key in overrides) {
      delete overrides[key]
    }
    dirty = false
  }

  const set = (props: Record<string, unknown>): void => {
    'worklet'
    const live = patchable.value
    let deferred = false
    for (const key in props) {
      const value = props[key]
      if (typeof value === 'number' && live[key] === true) {
        slots[key]!.value = value
      } else {
        deferred = true
      }
    }
    const onUI = (globalThis as { _WORKLET?: boolean })._WORKLET === true
    if (deferred) {
      // Re-encoding needs the scene graph, which only the JS thread holds.
      if (onUI && runOnJS != null) {
        runOnJS(applyOnJS)(props)
      } else {
        applyOnJS(props)
      }
    } else if (!onUI) {
      // On the UI thread the write itself wakes the animation driver's mapper.
      pushOnJS()
    }
  }

  const handle: NodeHandle = { set }
  Object.defineProperty(handle, 'isTgfxNode', { value: true })
  // React assigns the host instance to `ref.current` on the reconciler path.
  // Swallowed: nothing needs it, and an own enumerable property holding a node
  // tree is exactly what must not be cloned into a worklet.
  Object.defineProperty(handle, 'current', { get: () => null, set: () => {} })

  internals.set(handle, {
    apply(node: Node, reseed: boolean): Node {
      // Here rather than in the container: a handle whose node was unmounted is
      // in no compile at all, and its writes must not outlive the commit that
      // brings the node back either. `owner` is null only on the compile that
      // first binds this handle, and a write made before it has no commit of
      // its own to be dropped by.
      if (reseed && owner != null) {
        clearOverrides()
      }
      const props: Record<string, unknown> = { ...node.props }
      for (const key of SLOT_PROPS) {
        const value = props[key]
        // A SharedValue the caller passed stays theirs, and so does its slot.
        if (typeof value !== 'number') {
          continue
        }
        // `opacity` is the one prop not made live up front: a draw command has a
        // single alpha slot, so making it live is what decides whether an
        // enclosing opacity freezes. A write to it opts in, as a SharedValue
        // would, rather than a `ref` changing how the scene composites.
        if (key === 'opacity' && overrides[key] === undefined) {
          continue
        }
        if (reseed) {
          slots[key]!.value = value
        }
        props[key] = slots[key]
      }
      Object.assign(props, overrides)
      return { type: node.type, props, children: node.children }
    },
    bind(nextOwner: NodeOwner, w: SceneWriter): void {
      owner = nextOwner
      const next: Record<string, boolean> = {}
      for (const key of SLOT_PROPS) {
        if (w.hasSlot(slots[key]!)) {
          next[key] = true
        }
      }
      patchable.value = next
    },
  })
  return handle
}

/**
 * A stable {@link NodeHandle} for a drawing node. Pass it as `ref` and keep it
 * for the life of the component — it owns the node's live values, so a handle
 * recreated per render would lose them.
 */
export function useNode(): NodeHandle {
  const ref = useRef<NodeHandle | null>(null)
  if (ref.current == null) {
    ref.current = createHandle()
  }
  return ref.current
}
