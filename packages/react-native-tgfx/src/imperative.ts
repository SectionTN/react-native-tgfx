import { useRef } from 'react'
import { colorChannels, resolveColor, type Color } from './compiler/colors'
import type { Transform, TransformOp } from './compiler/transform'
import { isSharedValue, type MaybeSharedValue } from './compiler/values'
import type { SceneWriter } from './compiler/writer'
import {
  getRunOnJS,
  makeLive,
  makeShared,
  type LiveValue,
} from './reanimated/liveValue'
import { flagsOf, makeFlagBlock } from './reanimated/slotFlags'
import { NodeType, type Node } from './reconciler/types'
import type { UniformValue } from './types'

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
 * Transform operands. Not props of their own: they are patched inside the
 * `transform` array of the `<Group>` carrying the handle, which is the only node
 * kind the compiler writes a matrix for. `rotateZ` shares `rotate`'s slot and
 * `translate` splits across the two axis slots, so every spelling of an op lands
 * on the same value.
 */
const TRANSFORM_SLOTS = [
  'translateX',
  'translateY',
  'scale',
  'scaleX',
  'scaleY',
  'rotate',
  'skewX',
  'skewY',
] as const

type TransformSlot = (typeof TRANSFORM_SLOTS)[number]

/**
 * Byte offset of each key's patchable flag. Built once, never changed, so a
 * worklet capturing it by value is capturing the whole truth.
 */
const KEY_INDEX: Record<string, number> = {}
for (const name of SLOT_PROPS) {
  KEY_INDEX[name] = Object.keys(KEY_INDEX).length
}
for (const name of TRANSFORM_SLOTS) {
  KEY_INDEX[name] = Object.keys(KEY_INDEX).length
}
KEY_INDEX.color = Object.keys(KEY_INDEX).length
const FLAG_BYTES = Object.keys(KEY_INDEX).length

/**
 * Uniform components a handle can patch. Shared across every uniform the node's
 * `<Shader>` declares, assigned in declaration order at compile time.
 *
 * ponytail: fixed pool, sized for the shaders people write by hand. A uniform
 * past the end stays a literal and re-encodes on write; grow this, or key slots
 * by name, if a real shader ever needs more.
 */
const UNIFORM_SLOTS = 32

/** Where a uniform's components live in the pool, and how many it was given. */
interface UniformRun {
  at: number
  size: number
}

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
 * A prop the program keeps a value slot for is patched in place: one
 * `setValues`, no re-encode, and it works **inside a worklet**, so a gesture can
 * drive it without ever waking the JS thread. That covers the geometry props
 * (`x`, `y`, `width`, `height`, `cx`, `cy`, `r`, `rx`, `ry`, `x1`, `y1`, `x2`,
 * `y2`), `strokeWidth`, `opacity`, `fontSize`, `color`, a `<Group>`'s transform
 * operands (`translateX`, `translateY`, `scale`, `scaleX`, `scaleY`, `rotate`,
 * `skewX`, `skewY`) and a `<Shader>`'s `uniforms`. Anything else (`path`,
 * `text`, `image`) re-encodes the scene — still with no React render, no
 * reconciler commit and no Fabric commit — and from a worklet it hops to the JS
 * thread to do it.
 *
 * `color` and the transform operands are made live by the first write, not by
 * the `ref`: each costs the render thread work every frame, so that write
 * re-encodes once and every one after it is a slot patch. A `ref` on a
 * `<Shader>` has no other job, so its `uniforms` are live from the first
 * compile.
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
  /** A `<Shader>`'s uniforms, with the ones this handle owns made live. */
  applyUniforms(
    uniforms: Record<string, UniformValue> | undefined,
    reseed: boolean
  ): Record<string, UniformValue>
  bind(owner: NodeOwner, w: SceneWriter): void
}

// Off the handle itself: a worklet capturing the handle clones every own
// enumerable property, and these close over the scene graph.
const internals = new WeakMap<NodeHandle, Internals>()

let warnedOpOnNonGroup = false
let warnedFullPool = false
let warnedNonUniformOnShader = false
let warnedUniformsOnNode = false
let warnedUniformNeverLands = false

function warnOpOnNonGroup(key: string): void {
  if (warnedOpOnNonGroup) {
    return
  }
  warnedOpOnNonGroup = true
  console.warn(
    `[tgfx] '${key}' was written to a handle on a node that is not a <Group>: only a group carries a transform, so the write is dropped. Wrap the node in a <Group> and put the handle on that.`
  )
}

function warnNonUniformOnShader(key: string): void {
  if (warnedNonUniformOnShader) {
    return
  }
  warnedNonUniformOnShader = true
  console.warn(
    `[tgfx] '${key}' was written to a handle on a <Shader>, which is reached only through its uniforms — the write is dropped. Put the handle on the drawing node if you meant to change the node.`
  )
}

function warnUniformsOnNode(): void {
  if (warnedUniformsOnNode) {
    return
  }
  warnedUniformsOnNode = true
  console.warn(
    '[tgfx] `uniforms` was written to a handle on a drawing node, which carries none — the write is dropped. Put the handle on the <Shader> itself.'
  )
}

function warnUniformNeverLands(name: string): void {
  if (warnedUniformNeverLands) {
    return
  }
  warnedUniformNeverLands = true
  console.warn(
    `[tgfx] uniform '${name}' is not one the compiled program carries — the shader source does not declare it, or nothing draws the paint holding it. Writes to it are dropped.`
  )
}

function warnFullPool(name: string): void {
  if (warnedFullPool) {
    return
  }
  warnedFullPool = true
  console.warn(
    `[tgfx] uniform '${name}' is past the ${UNIFORM_SLOTS}-float pool one node handle keeps, so it gets no value slot and every write to it re-encodes the scene. Split the shader across two handles, or pack fewer uniforms into this one.`
  )
}

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

/** The slot a single-key transform op writes to, or null for one with no slot. */
function slotOfOp(op: Record<string, unknown>): TransformSlot | null {
  if ('rotateZ' in op || 'translate' in op) {
    return 'rotateZ' in op ? 'rotate' : 'translateX'
  }
  for (const name of TRANSFORM_SLOTS) {
    if (name in op) {
      return name
    }
  }
  return null
}

/**
 * A written uniform laid over the JSX one, component by component. Replacing it
 * wholesale would blank the components the write did not mention, and drop a
 * caller's SharedValue on a uniform that never got a slot.
 */
function mergeUniform(
  written: number[] | undefined,
  raw: UniformValue | undefined
): UniformValue {
  if (written === undefined) {
    return raw as UniformValue
  }
  if (raw === undefined) {
    return written as UniformValue
  }
  const base = Array.isArray(raw) ? raw : [raw]
  const width = Math.max(base.length, written.length)
  const out: UniformValue & unknown[] = []
  for (let i = 0; i < width; i++) {
    out.push(written[i] ?? base[i] ?? 0)
  }
  return out
}

function isOpSlot(key: string): key is TransformSlot {
  return (TRANSFORM_SLOTS as readonly string[]).includes(key)
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
  for (const name of TRANSFORM_SLOTS) {
    slots[name] = makeLive(name.startsWith('scale') ? 1 : 0)
  }
  // Red, green, blue, alpha in 0..1 — the only colour form a float slot carries.
  const colorSlots: LiveValue[] = []
  for (let i = 0; i < 4; i++) {
    colorSlots.push(makeLive(i === 3 ? 1 : 0))
  }
  const uniformSlots: LiveValue[] = []
  for (let i = 0; i < UNIFORM_SLOTS; i++) {
    uniformSlots.push(makeLive(0))
  }
  // Which of those the *current* program actually patches. Plain booleans inside
  // a shared value, so a worklet can tell a patchable write from one that needs
  // the JS thread.
  const patchable: MaybeSharedValue<Record<string, boolean>> = makeShared({})
  // The same answer as `patchable`, in bytes any runtime can load without a
  // cross-runtime call. Null when the native module is absent, which is the
  // only reason `patchable` still exists.
  const flagBlock = makeFlagBlock(FLAG_BYTES)
  const boxedFlags = flagBlock?.boxed ?? null
  const flagBytes = flagBlock?.bytes ?? null
  /** Uniform name to its run in the pool, for the ones that got one. */
  const uniformBase: MaybeSharedValue<Record<string, UniformRun>> = makeShared(
    {}
  )

  /** Non-slot writes, applied over the JSX props at compile time. */
  const overrides: Record<string, unknown> = {}
  /** Transform operands this handle has taken over, by slot name. */
  const ops: Record<string, boolean> = {}
  /**
   * Uniform components written since the last commit with no run wide enough to
   * hold them, by name. The *values*, so the compile that hands over the wider
   * run can seed it: the JS thread cannot read back a slot it has just written,
   * so the value has to be carried rather than recovered.
   */
  const pendingUniforms: Record<string, number[]> = {}
  /**
   * The pool layout, carried across compiles. A run is never moved once handed
   * out — relocating one would mean recovering its current value, and a slot
   * last written on the UI thread is not readable from here. Growth appends and
   * abandons the old run; a React commit reclaims the whole pool.
   */
  let pendingBases: Record<string, UniformRun> = {}
  /** Names granted a run that the compiled program did not take up. */
  const unslottable: Record<string, boolean> = {}
  /** High-water mark of the pool under the current layout. */
  let poolNext = 0
  let owner: NodeOwner | null = null
  let dirty = false
  /**
   * How the last compile reached this handle. A `<Shader>` is not a drawing
   * node: it is bound through `applyUniforms` alone, so nothing but `uniforms`
   * can reach it, and a write of anything else must be refused rather than ask
   * for a recompile that could never carry it.
   */
  let boundVia: 'node' | 'shader' | null = null
  /**
   * Whether the bound node takes a transform at all. Null until the first
   * compile: only a `<Group>` is written with a matrix, so an operand written
   * to anything else has nowhere to land and must not ask for a recompile that
   * can never satisfy it.
   */
  let nodeTakesOps: boolean | null = null

  /** Seed the colour slots from any colour input; JS thread only. */
  const seedColor = (value: unknown): void => {
    const channels = colorChannels(resolveColor(value as Color))
    for (let i = 0; i < 4; i++) {
      colorSlots[i]!.value = channels[i]!
    }
  }

  /** Unwrap a component that may be a SharedValue. Worklet-safe. */
  const num = (v: unknown): number => {
    'worklet'
    if (typeof v === 'number') {
      return v
    }
    if (v != null && typeof v === 'object' && 'value' in v) {
      return Number((v as { value: unknown }).value)
    }
    return Number(v)
  }

  /** The components a written uniform value carries, unwrapped. */
  const components = (raw: unknown): number[] => {
    'worklet'
    if (Array.isArray(raw)) {
      const out: number[] = []
      for (let i = 0; i < raw.length; i++) {
        out.push(num(raw[i]))
      }
      return out
    }
    return [num(raw)]
  }

  const applyOnJS = (props: Record<string, unknown>): void => {
    let recompile = false
    // Whether anything actually landed in a slot. A call that only wrote things
    // this node cannot carry has nothing to push, and pushing anyway costs a
    // native call and a render-thread redraw for values that did not move.
    let touched = false
    for (const key in props) {
      const value = props[key]
      const slot = slots[key]
      if (boundVia === 'shader' && key !== 'uniforms') {
        // A <Shader> is reached through applyUniforms, which reads neither
        // `overrides` nor `ops` — so anything else would recompile the scene
        // and change nothing, once per write.
        warnNonUniformOnShader(key)
        continue
      }
      if (key === 'color') {
        seedColor(value)
        if (patchable.value.color === true) {
          touched = true
          continue
        }
        // Live channels cost four slots and a per-frame paint rebuild, so they
        // are opted into by the first write rather than by the `ref`.
        overrides.color = colorSlots
      } else if (key === 'uniforms') {
        if (boundVia === 'node') {
          // Uniforms belong to a <Shader>, and a drawing node is compiled
          // through apply(), which never reads them. Recompiling would emit the
          // same bytes and leave the write nowhere, once per write.
          warnUniformsOnNode()
          continue
        }
        const written = value as Record<string, UniformValue> | undefined
        let regrow = false
        for (const name in written) {
          const wrote = components(written[name])
          const run = uniformBase.value[name]
          const fits = Math.min(wrote.length, run?.size ?? 0)
          for (let i = 0; i < fits; i++) {
            uniformSlots[run!.at + i]!.value = wrote[i]!
          }
          if (fits > 0) {
            touched = true
          }
          // No run, or one narrower than this write: ask the next compile for a
          // wider one, and hand it the values so it can seed what it hands
          // over. Only a change in the *value* is worth another compile — a
          // uniform the pool cannot fit would otherwise re-encode on every
          // write of the same number.
          if (wrote.length > (run?.size ?? 0)) {
            if (unslottable[name] === true) {
              // A compile already granted this name a run and the program did
              // not take it — the shader does not declare it, or nothing draws
              // the paint holding it. Another compile would be identical, so
              // the value is kept up to date and nothing else happens.
              pendingUniforms[name] = wrote
              warnUniformNeverLands(name)
              continue
            }
            const prev = pendingUniforms[name]
            if (prev == null || prev.length !== wrote.length) {
              pendingUniforms[name] = wrote
              regrow = true
            } else {
              for (let i = 0; i < wrote.length; i++) {
                if (prev[i] !== wrote[i]) {
                  prev[i] = wrote[i]!
                  regrow = true
                }
              }
            }
          }
        }
        if (!regrow) {
          continue
        }
      } else if (typeof value === 'number' && slot !== undefined) {
        if (isOpSlot(key) && nodeTakesOps === false) {
          // Only a <Group> is written with a matrix. Recompiling would not give
          // this operand a slot, so the next write would recompile again,
          // forever, and move nothing.
          warnOpOnNonGroup(key)
          continue
        }
        slot.value = value
        if (patchable.value[key] === true) {
          touched = true
          continue
        }
        if (isOpSlot(key)) {
          // A transform operand is not a prop: it is patched inside the array,
          // so it is recorded here and written into it at compile time.
          ops[key] = true
        } else {
          // No slot for it in the current program — either the element does not
          // carry the prop, or the compiler writes it as a literal (`Text`'s
          // `width`, an `opacity` that had to be folded into a product). Only a
          // fresh program carries the new value, every time.
          overrides[key] = slot
        }
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
    } else if (touched && runOnJS == null) {
      // Without Reanimated the slots are plain objects, so the writes above are
      // already visible and this is the only thing that pushes them. With it,
      // a write from here is applied on the UI thread later and the driver's
      // mapper pushes it there — pushing now would ship the pre-write values,
      // and reading them costs a blocking call per dirty slot.
      owner.pushValues()
    }
  }

  const clearOverrides = (): void => {
    if (!dirty) {
      return
    }
    for (const key in overrides) {
      delete overrides[key]
    }
    for (const key in ops) {
      delete ops[key]
    }
    for (const name in pendingUniforms) {
      delete pendingUniforms[name]
    }
    for (const name in unslottable) {
      delete unslottable[name]
    }
    dirty = false
  }

  const set = (props: Record<string, unknown>): void => {
    'worklet'
    const onUI = (globalThis as { _WORKLET?: boolean })._WORKLET === true
    if (!onUI) {
      // The JS thread never consults the shared records. A SharedValue written
      // from here is applied on the UI runtime *later* and does not update this
      // side's cached copy, so anything read back in the tick that `bind`
      // published it is the previous compile's answer — which has silently
      // dropped writes and patched the wrong uniform's slots. `applyOnJS` holds
      // the same bookkeeping in plain objects, live and synchronous, and is
      // strictly cheaper to reach than a cross-runtime read.
      applyOnJS(props)
      return
    }
    // Read lazily, and never more than once. On the UI runtime this is a plain
    // property read of the record's host copy. On any other worklet runtime — a
    // frame processor — it is a *blocking* call into the UI runtime, so a call
    // writing geometry must not pay for the uniform map it never looks at.
    // One load from native memory, no call and no allocation. `patchable` is
    // only consulted when the native side is not linked.
    const flags = boxedFlags != null ? flagsOf(boxedFlags) : null
    let live: Record<string, boolean> | null = null
    let bases: Record<string, UniformRun> | null = null
    let deferred = false
    const served: Record<string, boolean> = {}
    for (const key in props) {
      const value = props[key]
      if (key === 'color') {
        if (flags === null && live === null) {
          live = patchable.value
        }
        // A packed `0xAARRGGBB` number or `[r, g, b, a]` in 0..1; a colour
        // string needs the parser, which only the JS thread has.
        if (
          flags !== null ? flags[KEY_INDEX.color!] !== 1 : live!.color !== true
        ) {
          deferred = true
        } else if (typeof value === 'number') {
          const packed = value >>> 0
          colorSlots[0]!.value = ((packed >>> 16) & 0xff) / 255
          colorSlots[1]!.value = ((packed >>> 8) & 0xff) / 255
          colorSlots[2]!.value = (packed & 0xff) / 255
          colorSlots[3]!.value = ((packed >>> 24) & 0xff) / 255
          served.color = true
        } else if (Array.isArray(value) && value.length === 4) {
          for (let i = 0; i < 4; i++) {
            // A channel may itself be a SharedValue: `Color` allows one, so
            // taking `Number()` of it straight would store NaN.
            colorSlots[i]!.value = num(value[i])
          }
          served.color = true
        } else {
          deferred = true
        }
      } else if (key === 'uniforms') {
        if (bases === null) {
          bases = uniformBase.value
        }
        const written = value as Record<string, UniformValue>
        for (const name in written) {
          const run = bases[name]
          const wrote = components(written[name])
          if (run === undefined || wrote.length > run.size) {
            deferred = true
            continue
          }
          for (let i = 0; i < wrote.length; i++) {
            uniformSlots[run.at + i]!.value = wrote[i]!
          }
        }
        // Uniforms travel as one key; any name that could not be served sends
        // the whole map back, and applyOnJS re-checks each against live state.
        if (!deferred) {
          served.uniforms = true
        }
      } else {
        if (flags === null && live === null) {
          live = patchable.value
        }
        const at = KEY_INDEX[key]
        const patchableHere =
          flags !== null
            ? at !== undefined && flags[at] === 1
            : live![key] === true
        if (typeof value === 'number' && patchableHere) {
          slots[key]!.value = value
          served[key] = true
        } else {
          deferred = true
        }
      }
    }
    if (deferred) {
      // Re-encoding needs the scene graph, which only the JS thread holds. Only
      // the keys that could not be served travel: replaying the whole snapshot
      // would put values this runtime has already moved past back on the wire.
      const rest: Record<string, unknown> = {}
      for (const key in props) {
        if (served[key] !== true) {
          rest[key] = props[key]
        }
      }
      if (runOnJS != null) {
        runOnJS(applyOnJS)(rest)
      } else {
        applyOnJS(rest)
      }
    }
  }

  const hasOps = (): boolean => {
    for (const key in ops) {
      if (ops[key] === true) {
        return true
      }
    }
    return false
  }

  /**
   * The node's transform with every operand this handle has been written to
   * replaced by its slot, plus an appended op for each written operand the array
   * does not carry. Appended ops come last, in {@link TRANSFORM_SLOTS} order.
   *
   * Only written operands are made live: one slot anywhere in a group's ops
   * costs it a matrix rebuild per frame, so a `ref` alone must not buy that.
   */
  const applyOps = (node: Node): Transform | undefined => {
    if (!hasOps()) {
      return undefined
    }
    const taken: Record<string, boolean> = {}
    const out: TransformOp[] = []
    for (const op of (node.props.transform as Transform | undefined) ?? []) {
      const record = op as Record<string, unknown>
      const name = slotOfOp(record)
      if (
        name === 'translateX' &&
        'translate' in record &&
        taken.translateX !== true &&
        taken.translateY !== true
      ) {
        const pair = record.translate as [unknown, unknown]
        taken.translateX = true
        taken.translateY = true
        out.push({
          translate: [
            ops.translateX === true ? slots.translateX! : pair[0],
            ops.translateY === true ? slots.translateY! : pair[1],
          ],
        } as TransformOp)
        continue
      }
      // Not written to, one we keep no slot for, or a second op of the same
      // kind — the first one owns the slot, so this stays as it was written.
      if (name == null || ops[name] !== true || taken[name] === true) {
        out.push(op)
        continue
      }
      taken[name] = true
      out.push({ [name]: slots[name]! } as unknown as TransformOp)
    }
    for (const name of TRANSFORM_SLOTS) {
      if (ops[name] === true && taken[name] !== true) {
        out.push({ [name]: slots[name]! } as unknown as TransformOp)
      }
    }
    return out
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
        // A write made before this handle had a program of its own has no
        // commit to be dropped by, and `overrides` is how it survived to here —
        // reseeding the slot it points at would discard it.
        if (reseed && overrides[key] === undefined) {
          slots[key]!.value = value
        }
        props[key] = slots[key]
      }
      // Only a <Group> is written with a matrix, so an op on anything else has
      // nowhere to go; recorded here so a write to one can be refused rather
      // than asking for a recompile that could never satisfy it.
      boundVia = 'node'
      nodeTakesOps = node.type === NodeType.Group
      if (nodeTakesOps) {
        const transform = applyOps(node)
        if (transform !== undefined) {
          props.transform = transform
        }
      }
      Object.assign(props, overrides)
      return { type: node.type, props, children: node.children }
    },
    applyUniforms(
      uniforms: Record<string, UniformValue> | undefined,
      reseed: boolean
    ): Record<string, UniformValue> {
      // A <Shader> is not a drawing node: nothing but its uniforms can reach
      // this handle, and it carries no matrix.
      boundVia = 'shader'
      nodeTakesOps = false
      if (reseed && owner != null) {
        clearOverrides()
      }
      // A commit reclaims the pool: the JSX is the truth again, so the layout
      // is rebuilt from it and every abandoned run is recovered.
      if (reseed) {
        pendingBases = {}
        poolNext = 0
      }
      const out: Record<string, UniformValue> = {}
      const bases: Record<string, UniformRun> = {}
      // Declaration order, plus any name written since the last commit that the
      // JSX does not carry, plus everything the current layout already holds —
      // a name that won a run through a write is not in the JSX, and would
      // otherwise lose that run on the next compile.
      const names = new Set([
        ...Object.keys(uniforms ?? {}),
        ...Object.keys(pendingUniforms),
        ...Object.keys(pendingBases),
      ])
      for (const name of names) {
        const raw = uniforms?.[name]
        const written = pendingUniforms[name]
        const declared = Array.isArray(raw) ? raw.length : raw != null ? 1 : 0
        const existing = pendingBases[name]
        const size = Math.max(
          declared,
          written?.length ?? 0,
          existing?.size ?? 0
        )
        // A caller's own SharedValue stays theirs, exactly as it does for a slot
        // prop: taking the uniform over would swap in a slot this handle owns
        // and nothing drives, silently killing their animation.
        const caller =
          (Array.isArray(raw) && raw.some(isSharedValue)) || isSharedValue(raw)
        // Kept if it already has one big enough — never moved, so whatever the
        // slot holds stays valid whichever thread last wrote it.
        const keep =
          existing !== undefined && existing.size >= size ? existing : null
        const room = keep != null || poolNext + size <= UNIFORM_SLOTS
        if (size === 0 || caller || !room) {
          // No slot to patch, so the value travels as a literal — component by
          // component over the JSX, so a partial write does not blank the rest.
          out[name] = mergeUniform(written, raw)
          if (out[name] === undefined) {
            delete out[name]
          }
          if (!caller && size > 0 && !room) {
            warnFullPool(name)
          }
          continue
        }
        const run = keep ?? { at: poolNext, size }
        if (keep == null) {
          poolNext += size
        }
        bases[name] = run
        const live: (number | MaybeSharedValue<number>)[] = []
        for (let i = 0; i < run.size; i++) {
          // A run just handed over starts from the value that asked for it, or
          // the JSX literal. One that was already held keeps what it holds —
          // the imperative writes that put it there are still the truth until a
          // commit, and a commit resets the layout above.
          if (keep == null) {
            const seed =
              written?.[i] ?? (Array.isArray(raw) ? raw[i] : i === 0 ? raw : 0)
            if (typeof seed === 'number') {
              uniformSlots[run.at + i]!.value = seed
            }
          }
          live.push(uniformSlots[run.at + i]!)
        }
        out[name] = live as UniformValue
      }
      pendingBases = bases
      return out
    },
    bind(nextOwner: NodeOwner, w: SceneWriter): void {
      owner = nextOwner
      const next: Record<string, boolean> = {}
      for (const key of SLOT_PROPS) {
        if (w.hasSlot(slots[key]!)) {
          next[key] = true
        }
      }
      for (const key of TRANSFORM_SLOTS) {
        if (w.hasSlot(slots[key]!)) {
          next[key] = true
        }
      }
      if (w.hasSlot(colorSlots[0]!)) {
        next.color = true
      }
      if (flagBytes !== null) {
        // A store per key, seen by every runtime the instant it lands. The
        // shared record below is only for a build with no native side.
        for (const key in KEY_INDEX) {
          flagBytes[KEY_INDEX[key]!] = next[key] === true ? 1 : 0
        }
      }
      patchable.value = next
      const bases: Record<string, UniformRun> = {}
      for (const name in pendingBases) {
        const run = pendingBases[name]!
        if (!w.hasSlot(uniformSlots[run.at]!)) {
          // A run the program never patches: the name is not one the shader
          // declares, or nothing drew this node's paint. Recorded so a later
          // write stops asking for a compile that cannot help.
          unslottable[name] = true
          continue
        }
        delete unslottable[name]
        bases[name] = run
        // The run reached the program, so the value that asked for it has done
        // its job. Left in place it would outrank the slot on a later compile
        // and undo every write made since.
        delete pendingUniforms[name]
      }
      uniformBase.value = bases
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
