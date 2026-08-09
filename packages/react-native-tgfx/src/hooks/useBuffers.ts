import { useRef } from 'react'
import type { TgfxBuffer, TgfxBufferFactory } from '../specs/TgfxBuffer.nitro'

/** Floats per `<Atlas>` sprite: srcX, srcY, srcW, srcH, scale, centreX, centreY. */
export const SPRITE_FLOATS = 7

/** A boxed `TgfxBuffer`, the form that survives a hop to another runtime. */
interface BoxedBuffer {
  unbox(): TgfxBuffer
}

interface Nitro {
  NitroModules?: {
    createHybridObject?: <T>(name: string) => T
    box?: <T>(obj: T) => BoxedBuffer
  }
}

let cached: Nitro | null = null

function nitro(): Nitro {
  if (cached == null) {
    try {
      cached = require('react-native-nitro-modules') as Nitro
    } catch {
      cached = {}
    }
  }
  return cached
}

function createBuffer(
  floats: number
): { native: TgfxBuffer; boxed: BoxedBuffer } | null {
  const modules = nitro().NitroModules
  if (modules?.createHybridObject == null || modules.box == null) {
    return null
  }
  try {
    const native = modules
      .createHybridObject<TgfxBufferFactory>('TgfxBufferFactory')
      .create(floats)
    return { native, boxed: modules.box(native) }
  } catch {
    return null
  }
}

/**
 * This runtime's view of the block, cached on its global: a worklet's captured
 * closure deep-clones a plain `Float32Array`, so writes to one would land in a
 * copy the renderer never sees. The boxed object survives the hop; unboxing on
 * the calling runtime maps the same native memory.
 */
function floatsOf(boxed: BoxedBuffer): Float32Array {
  'worklet'
  const scope = globalThis as {
    __tgfxBufferViews?: WeakMap<BoxedBuffer, Float32Array>
  }
  let views = scope.__tgfxBufferViews
  if (views === undefined) {
    views = new WeakMap<BoxedBuffer, Float32Array>()
    scope.__tgfxBufferViews = views
  }
  let view = views.get(boxed)
  if (view === undefined) {
    view = new Float32Array(boxed.unbox().buffer)
    views.set(boxed, view)
  }
  return view
}

/**
 * A shared sprite buffer for `<Atlas buffer count>`: `capacity` sprites of
 * {@link SPRITE_FLOATS} floats each, written in place and read by the renderer
 * at draw. `set` is a worklet — call it from either thread; it writes the same
 * native memory. Write `data` directly for bulk updates on the JS thread.
 *
 * Without the native module (tests, web) `id` is 0 and the atlas falls back to
 * its inline `sprites` list.
 */
export interface SpriteBuffer {
  readonly id: number
  readonly capacity: number
  /** The JS thread's raw floats, `capacity * SPRITE_FLOATS` long. */
  readonly data: Float32Array
  /** Write sprite `i`: source rect, uniform scale, and the sprite's centre. */
  set(
    i: number,
    srcX: number,
    srcY: number,
    srcW: number,
    srcH: number,
    scale: number,
    x: number,
    y: number
  ): void
}

function makeSpriteBuffer(capacity: number): SpriteBuffer {
  const created = createBuffer(capacity * SPRITE_FLOATS)
  const boxed = created?.boxed ?? null
  const fallback =
    created != null
      ? new Float32Array(created.native.buffer)
      : new Float32Array(capacity * SPRITE_FLOATS)
  const set: SpriteBuffer['set'] = (i, srcX, srcY, srcW, srcH, scale, x, y) => {
    'worklet'
    const data = boxed != null ? floatsOf(boxed) : fallback
    const at = i * SPRITE_FLOATS
    data[at] = srcX
    data[at + 1] = srcY
    data[at + 2] = srcW
    data[at + 3] = srcH
    data[at + 4] = scale
    data[at + 5] = x
    data[at + 6] = y
  }
  return { id: created?.native.id ?? 0, capacity, data: fallback, set }
}

/** A stable {@link SpriteBuffer}; `capacity` is read once, on first render. */
export function useSpriteBuffer(capacity: number): SpriteBuffer {
  const ref = useRef<SpriteBuffer | null>(null)
  if (ref.current == null) {
    ref.current = makeSpriteBuffer(capacity)
  }
  return ref.current
}

export interface VertexBufferOptions {
  maxVertices: number
  maxIndices?: number
  /** Reserve a texture-coordinate section (2 floats per vertex). */
  textures?: boolean
  /** Reserve a colour section (r, g, b, a in 0..1 per vertex). */
  colors?: boolean
}

export interface MeshViews {
  /** x, y per vertex. */
  positions: Float32Array
  /** u, v per vertex, in image pixels; empty unless reserved. */
  textures: Float32Array
  /** r, g, b, a per vertex in 0..1; empty unless reserved. */
  colors: Float32Array
  /** One float per index; empty unless `maxIndices` was given. */
  indices: Float32Array
}

/**
 * A shared mesh buffer for `<Vertices buffer vertexCount indexCount>`. One
 * allocation, sectioned. The `positions` / `textures` / `colors` / `indices`
 * views belong to the JS thread; inside a worklet call {@link meshViews} to
 * get this runtime's views over the same memory.
 */
export interface VertexBuffer extends MeshViews {
  readonly id: number
  readonly maxVertices: number
  readonly maxIndices: number
  readonly hasTextures: boolean
  readonly hasColors: boolean
  /** @internal the cross-runtime handle meshViews() unboxes. */
  readonly boxed: BoxedBuffer | null
}

function sectionsOf(all: Float32Array, buffer: VertexBufferOptions): MeshViews {
  const maxVertices = Math.max(0, Math.trunc(buffer.maxVertices))
  const maxIndices = Math.max(0, Math.trunc(buffer.maxIndices ?? 0))
  let at = 0
  const section = (length: number): Float32Array => {
    const view = all.subarray(at, at + length)
    at += length
    return view
  }
  return {
    positions: section(maxVertices * 2),
    textures: section(buffer.textures === true ? maxVertices * 2 : 0),
    colors: section(buffer.colors === true ? maxVertices * 4 : 0),
    indices: section(maxIndices),
  }
}

/**
 * This runtime's section views over a {@link VertexBuffer}'s memory. A worklet
 * must go through this — its captured copies of the JS-thread views write to a
 * clone. Cached per runtime, so a per-frame call allocates nothing after the
 * first.
 */
export function meshViews(buffer: VertexBuffer): MeshViews {
  'worklet'
  if (buffer.boxed == null) {
    return buffer
  }
  const scope = globalThis as {
    __tgfxMeshViews?: WeakMap<BoxedBuffer, MeshViews>
  }
  let views = scope.__tgfxMeshViews
  if (views === undefined) {
    views = new WeakMap<BoxedBuffer, MeshViews>()
    scope.__tgfxMeshViews = views
  }
  let sections = views.get(buffer.boxed)
  if (sections === undefined) {
    const all = floatsOf(buffer.boxed)
    const maxVertices = buffer.maxVertices
    let at = 0
    const section = (length: number): Float32Array => {
      const view = all.subarray(at, at + length)
      at += length
      return view
    }
    sections = {
      positions: section(maxVertices * 2),
      textures: section(buffer.hasTextures ? maxVertices * 2 : 0),
      colors: section(buffer.hasColors ? maxVertices * 4 : 0),
      indices: section(buffer.maxIndices),
    }
    views.set(buffer.boxed, sections)
  }
  return sections
}

function makeVertexBuffer(options: VertexBufferOptions): VertexBuffer {
  const maxVertices = Math.max(0, Math.trunc(options.maxVertices))
  const maxIndices = Math.max(0, Math.trunc(options.maxIndices ?? 0))
  const hasTextures = options.textures === true
  const hasColors = options.colors === true
  const total =
    maxVertices * 2 +
    (hasTextures ? maxVertices * 2 : 0) +
    (hasColors ? maxVertices * 4 : 0) +
    maxIndices
  const created = createBuffer(total)
  const all =
    created != null
      ? new Float32Array(created.native.buffer)
      : new Float32Array(total)
  return {
    id: created?.native.id ?? 0,
    maxVertices,
    maxIndices,
    hasTextures,
    hasColors,
    boxed: created?.boxed ?? null,
    ...sectionsOf(all, options),
  }
}

/** A stable {@link VertexBuffer}; options are read once, on first render. */
export function useVertexBuffer(options: VertexBufferOptions): VertexBuffer {
  const ref = useRef<VertexBuffer | null>(null)
  if (ref.current == null) {
    ref.current = makeVertexBuffer(options)
  }
  return ref.current
}
