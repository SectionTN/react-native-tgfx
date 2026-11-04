import { expect, mock, test } from 'bun:test'

mock.module('react-native-reanimated', () => ({}))
import { TgfxContainer } from '../reconciler/Container'
import { NodeType, type Node } from '../reconciler/types'
import type { FlagBlock } from '../reanimated/slotFlags'

/** A SharedValue whose `.value` read is a cross-runtime hop on Reanimated 4: count them. */
function shared(value: number): {
  sv: { value: number; _isReanimatedSharedValue: true }
  reads: () => number
} {
  let reads = 0
  const sv = {
    _isReanimatedSharedValue: true as const,
    modify() {},
    get value(): number {
      reads++
      return value
    },
  }
  return { sv, reads: () => reads }
}

const block = (values: number[], written: boolean): FlagBlock =>
  ({
    bytes: new Uint8Array([written ? 1 : 0]),
    values: new Float64Array(values),
    slots: {},
    boxed: {},
  }) as unknown as FlagBlock

test('a commit snapshots an animating slot from the mirror, not from .value', () => {
  const x = shared(5)
  const y = shared(6)
  const words: Float64Array[] = []
  const container = new TgfxContainer((buffer) => {
    words.push(new Float64Array(buffer))
  })
  const roots = [
    {
      type: NodeType.Circle,
      props: { cx: x.sv, cy: y.sv, r: 1, color: '#fff' },
      children: [],
    },
  ] as Node[]
  container.setRootDirect(roots)
  // First commit: nothing mirrored yet, so the literals come from .value.
  expect(Array.from(words[0]!.subarray(5, 7))).toEqual([5, 6])
  expect(x.reads()).toBe(1)
  // The driver pushed since; a mirror stands in for the UI thread.
  container.mirror = { values: [x.sv, y.sv], block: block([50, 60], true) }
  container.redraw()
  expect(Array.from(words[1]!.subarray(5, 7))).toEqual([50, 60])
  expect(x.reads()).toBe(1)
  // An unwritten mirror is not trusted; the last program's literals stand in.
  container.mirror = { values: [x.sv, y.sv], block: block([0, 0], false) }
  container.redraw()
  expect(Array.from(words[2]!.subarray(5, 7))).toEqual([50, 60])
  expect(x.reads()).toBe(1)
  // A value this container has never seen is read once.
  const z = shared(9)
  container.setRootDirect([
    {
      type: NodeType.Circle,
      props: { cx: x.sv, cy: z.sv, r: 1, color: '#fff' },
      children: [],
    },
  ] as Node[])
  expect(Array.from(words[3]!.subarray(5, 7))).toEqual([50, 9])
  expect(x.reads()).toBe(1)
  expect(z.reads()).toBe(1)
})

test('a JS-thread push takes mirrored values the same way', () => {
  const x = shared(5)
  const pushed: number[][] = []
  const container = new TgfxContainer(() => {})
  container.onValues = (values) => pushed.push(values.slice())
  container.setRootDirect([
    {
      type: NodeType.Rect,
      props: { x: x.sv, y: 0, width: 1, height: 1 },
      children: [],
    },
  ] as Node[])
  container.mirror = { values: [x.sv], block: block([7], true) }
  const before = x.reads()
  container.pushValues()
  expect(pushed).toEqual([[7]])
  expect(x.reads()).toBe(before)
})

test('with a driver to follow, an unseen mutable is deferred and the program flagged', () => {
  const x = shared(5)
  const words: Float64Array[] = []
  const container = new TgfxContainer((buffer) => {
    words.push(new Float64Array(buffer))
  })
  container.deferReads = true
  const pushed: number[][] = []
  container.onValues = (values) => pushed.push(values.slice())
  container.setRootDirect([
    {
      type: NodeType.Rect,
      props: { x: x.sv, y: 0, width: 1, height: 1 },
      children: [],
    },
  ] as Node[])
  expect(x.reads()).toBe(0)
  expect(container.unresolved).toBe(true)
  expect(words[0]![5]).toBe(0)
  // The push that would carry a placeholder is left to the driver.
  container.pushValues()
  expect(pushed).toEqual([])
  // The driver pushed since: the mirror resolves it and the hold is over.
  container.mirror = { values: [x.sv], block: block([7], true) }
  container.redraw()
  expect(container.unresolved).toBe(false)
  expect(words[1]![5]).toBe(7)
  container.pushValues()
  expect(pushed).toEqual([[7]])
  expect(x.reads()).toBe(0)
})

/** What a handle holds without Reanimated: a plain slot, read fresh on every push. */
const plainSlot = (value: number) => ({
  value,
  _isReanimatedSharedValue: true as const,
})

/** A mirror that logs its stores by index, to tell a write-back from an entry left alone. */
function loggedBlock(values: number[], written: boolean) {
  const b = block(values, written)
  const stores: number[] = []
  b.values = new Proxy(b.values, {
    set(target, key, value: number) {
      stores.push(Number(key))
      target[Number(key)] = value
      return true
    },
  })
  return { b, stores }
}

const rectAt = (x: unknown, y: unknown = 0): Node[] =>
  [
    { type: NodeType.Rect, props: { x, y, width: 1, height: 1 }, children: [] },
  ] as Node[]

test('a JS-thread push writes its slots into the mirror and hands over the block', () => {
  const slot = plainSlot(3)
  const arrays: number[][] = []
  const container = new TgfxContainer(() => {})
  container.onValues = (values) => arrays.push(values.slice())
  container.setRootDirect(rectAt(slot))
  const mirror = block([0], false)
  container.mirror = { values: [slot], block: mirror }
  const offered: FlagBlock[] = []
  container.onBlock = (b) => {
    offered.push(b)
    return true
  }
  slot.value = 8
  container.pushValues()
  expect(offered).toHaveLength(1)
  expect(offered[0]).toBe(mirror)
  expect(mirror.values[0]).toBe(8)
  expect(arrays).toEqual([])
})

test('a JS-thread push leaves a mutable the driver wrote alone', () => {
  const x = shared(5)
  const slot = plainSlot(3)
  const container = new TgfxContainer(() => {})
  container.setRootDirect(rectAt(x.sv, slot))
  const { b, stores } = loggedBlock([7, 0], true)
  container.mirror = { values: [x.sv, slot], block: b }
  container.onBlock = () => true
  const before = x.reads()
  container.pushValues()
  expect(stores).toEqual([1])
  expect([b.values[0], b.values[1]]).toEqual([7, 3])
  expect(x.reads()).toBe(before)
})

test('before the driver writes the mirror, a JS-thread push stores the literal the program carries', () => {
  const x = shared(5)
  const container = new TgfxContainer(() => {})
  container.setRootDirect(rectAt(x.sv))
  const mirror = block([0], false)
  container.mirror = { values: [x.sv], block: mirror }
  container.onBlock = () => true
  container.pushValues()
  expect(mirror.values[0]).toBe(5)
  expect(x.reads()).toBe(1)
})

test('a target that cannot take the block gets the array instead', () => {
  const slot = plainSlot(3)
  const arrays: number[][] = []
  const container = new TgfxContainer(() => {})
  container.onValues = (values) => arrays.push(values.slice())
  container.setRootDirect(rectAt(slot))
  container.mirror = { values: [slot], block: block([0], false) }
  let offered = 0
  container.onBlock = () => {
    offered++
    return false
  }
  container.pushValues()
  expect(offered).toBe(1)
  expect(arrays).toEqual([[3]])
})

test('without a mirror block a JS-thread push is an array', () => {
  const slot = plainSlot(3)
  const arrays: number[][] = []
  const container = new TgfxContainer(() => {})
  container.onValues = (values) => arrays.push(values.slice())
  container.onBlock = () => {
    throw new Error('no block to hand over')
  }
  container.setRootDirect(rectAt(slot))
  expect(container.mirror).toBeNull()
  container.pushValues()
  expect(arrays).toEqual([[3]])
})

/** A handle's block slot: an accessor over shared bytes, plus the boxed block a reader can view itself. */
function blockSlot(value: number) {
  const values = new ArrayBuffer(16)
  const bytes = new Float64Array(values)
  bytes[1] = value
  let reads = 0
  const slot = {
    _isReanimatedSharedValue: true as const,
    __tgfxBoxed: { unbox: () => ({ values }) },
    __tgfxAt: 1,
    get value(): number {
      reads++
      return bytes[1]!
    },
  }
  return { slot, bytes, reads: () => reads }
}

test('a JS-thread push reads a block slot from its block, not through its accessor', () => {
  const b = blockSlot(4)
  const container = new TgfxContainer(() => {})
  container.setRootDirect(rectAt(b.slot))
  const mirror = block([0], false)
  container.mirror = { values: [b.slot], block: mirror }
  container.onBlock = () => true
  b.bytes[1] = 9
  const before = b.reads()
  container.pushValues()
  expect(mirror.values[0]).toBe(9)
  expect(b.reads()).toBe(before)
})
