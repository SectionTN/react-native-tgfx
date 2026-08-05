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

const KEY_INDEX: Record<string, number> = {}
for (const name of SLOT_PROPS) {
  KEY_INDEX[name] = Object.keys(KEY_INDEX).length
}
for (const name of TRANSFORM_SLOTS) {
  KEY_INDEX[name] = Object.keys(KEY_INDEX).length
}
KEY_INDEX.color = Object.keys(KEY_INDEX).length
const FLAG_BYTES = Object.keys(KEY_INDEX).length

const UNIFORM_SLOTS = 32

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

interface Internals {
  apply(node: Node, reseed: boolean): Node
  applyUniforms(
    uniforms: Record<string, UniformValue> | undefined,
    reseed: boolean
  ): Record<string, UniformValue>
  bind(owner: NodeOwner, w: SceneWriter): void
}

// Off the handle itself: a worklet clones every own enumerable property, and these hold the graph.
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
  // Resolved now, or the worklet would capture a remote handle instead of the function.
  const runOnJS = getRunOnJS()
  const slots: Record<string, LiveValue> = {}
  for (const name of SLOT_PROPS) {
    slots[name] = makeLive(0)
  }
  for (const name of TRANSFORM_SLOTS) {
    slots[name] = makeLive(name.startsWith('scale') ? 1 : 0)
  }
  const colorSlots: LiveValue[] = []
  for (let i = 0; i < 4; i++) {
    colorSlots.push(makeLive(i === 3 ? 1 : 0))
  }
  const uniformSlots: LiveValue[] = []
  for (let i = 0; i < UNIFORM_SLOTS; i++) {
    uniformSlots.push(makeLive(0))
  }
  const patchable: MaybeSharedValue<Record<string, boolean>> = makeShared({})
  const flagBlock = makeFlagBlock(FLAG_BYTES)
  const boxedFlags = flagBlock?.boxed ?? null
  const flagBytes = flagBlock?.bytes ?? null
  const uniformBase: MaybeSharedValue<Record<string, UniformRun>> = makeShared(
    {}
  )

  const overrides: Record<string, unknown> = {}
  const ops: Record<string, boolean> = {}
  const pendingUniforms: Record<string, number[]> = {}
  let pendingBases: Record<string, UniformRun> = {}
  const unslottable: Record<string, boolean> = {}
  let poolNext = 0
  let owner: NodeOwner | null = null
  let dirty = false
  let boundVia: 'node' | 'shader' | null = null
  let nodeTakesOps: boolean | null = null

  const seedColor = (value: unknown): void => {
    const channels = colorChannels(resolveColor(value as Color))
    for (let i = 0; i < 4; i++) {
      colorSlots[i]!.value = channels[i]!
    }
  }

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
    let touched = false
    for (const key in props) {
      const value = props[key]
      const slot = slots[key]
      if (boundVia === 'shader' && key !== 'uniforms') {
        warnNonUniformOnShader(key)
        continue
      }
      if (key === 'color') {
        seedColor(value)
        if (patchable.value.color === true) {
          touched = true
          continue
        }
        overrides.color = colorSlots
      } else if (key === 'uniforms') {
        if (boundVia === 'node') {
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
          if (wrote.length > (run?.size ?? 0)) {
            if (unslottable[name] === true) {
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
          warnOpOnNonGroup(key)
          continue
        }
        slot.value = value
        if (patchable.value[key] === true) {
          touched = true
          continue
        }
        if (isOpSlot(key)) {
          ops[key] = true
        } else {
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
      return
    }
    if (recompile) {
      owner.recompile()
    } else if (touched && runOnJS == null) {
      // Without Reanimated this is the only push; with it the driver's mapper pushes on the UI thread.
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
      // The JS thread never consults the shared records: a read back this tick is the last compile's.
      applyOnJS(props)
      return
    }
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
      // Only the unservable keys travel: the whole snapshot would undo what this runtime moved past.
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
  // React assigns the host instance here; swallowed, or a worklet would clone a node tree.
  Object.defineProperty(handle, 'current', { get: () => null, set: () => {} })

  internals.set(handle, {
    apply(node: Node, reseed: boolean): Node {
      // Here, not in the container: an unmounted node is in no compile, and its writes must not outlive the commit that brings it back.
      if (reseed && owner != null) {
        clearOverrides()
      }
      const props: Record<string, unknown> = { ...node.props }
      for (const key of SLOT_PROPS) {
        const value = props[key]
        if (typeof value !== 'number') {
          continue
        }
        if (key === 'opacity' && overrides[key] === undefined) {
          continue
        }
        // A write made before this handle had a program survived via `overrides`; do not reseed it.
        if (reseed && overrides[key] === undefined) {
          slots[key]!.value = value
        }
        props[key] = slots[key]
      }
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
      boundVia = 'shader'
      nodeTakesOps = false
      if (reseed && owner != null) {
        clearOverrides()
      }
      // A commit reclaims the pool: the JSX is the truth again, so the layout is rebuilt from it.
      if (reseed) {
        pendingBases = {}
        poolNext = 0
      }
      const out: Record<string, UniformValue> = {}
      const bases: Record<string, UniformRun> = {}
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
        // A caller's own SharedValue stays theirs, or their animation dies against a slot nothing drives.
        const caller =
          (Array.isArray(raw) && raw.some(isSharedValue)) || isSharedValue(raw)
        const keep =
          existing !== undefined && existing.size >= size ? existing : null
        const room = keep != null || poolNext + size <= UNIFORM_SLOTS
        if (size === 0 || caller || !room) {
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
        for (const key in KEY_INDEX) {
          flagBytes[KEY_INDEX[key]!] = next[key] === true ? 1 : 0
        }
      }
      patchable.value = next
      const bases: Record<string, UniformRun> = {}
      for (const name in pendingBases) {
        const run = pendingBases[name]!
        if (!w.hasSlot(uniformSlots[run.at]!)) {
          unslottable[name] = true
          continue
        }
        delete unslottable[name]
        bases[name] = run
        // The seed has done its job; left in place it would outrank the slot on a later compile.
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
