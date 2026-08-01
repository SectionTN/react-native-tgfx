import { expect, test } from 'bun:test'
import { NodeType, type Node } from '../reconciler/types'
import { compileScene } from './compile'
import { Kind, SCENE_VERSION, SceneWriter } from './writer'

const node = (type: unknown, props: object, children: Node[] = []): Node =>
  ({ type, props, children }) as Node

const sharedValue = (value: number) => ({
  value,
  _isReanimatedSharedValue: true as const,
})

function compile(roots: Node[]) {
  const writer = new SceneWriter()
  const result = compileScene(roots, writer)
  const words = new Float64Array(result.buffer)
  return { ...result, words, used: words.subarray(0, words[1]) }
}

test('encodes a rect with its paint', () => {
  const { words, used, strings, values } = compile([
    node(NodeType.Rect, { x: 1, y: 2, width: 3, height: 4, color: '#ff0000' }),
  ])
  expect(words[0]).toBe(SCENE_VERSION)
  expect(strings).toEqual([])
  expect(values).toEqual([])
  // header(3) rootCount kind x y w h + paint(color flags sw cap join alpha
  // shader) + patch table (count only)
  expect(used.length).toBe(3 + 1 + 5 + 7 + 1)
  expect(Array.from(used.subarray(3, 9))).toEqual([1, Kind.Rect, 1, 2, 3, 4])
  expect(used[9]).toBe(0xffff0000) // packed AARRGGBB
  expect(used[10]).toBe(2) // fill + antiAlias
  expect(used[15]).toBe(-1) // no shader
})

test('records a patch for every animated field, and reuses one slot', () => {
  const radius = sharedValue(7)
  const { used, values } = compile([
    node(NodeType.Circle, { cx: radius, cy: 5, r: radius }),
  ])
  expect(values).toEqual([radius])
  const patchStart = used[2]
  expect(used[patchStart]).toBe(2)
  // Both patched words point at the same slot, and at cx and r respectively.
  expect(used[patchStart + 1]).toBe(5)
  expect(used[patchStart + 2]).toBe(0)
  expect(used[patchStart + 3]).toBe(7)
  expect(used[patchStart + 4]).toBe(0)
  expect(used[5]).toBe(0)
  expect(used[6]).toBe(5)
})

test('interns strings and references them by index', () => {
  const { used, strings } = compile([
    node(NodeType.Path, { path: 'M0 0 L1 1' }),
    node(NodeType.Path, { path: 'M0 0 L1 1' }),
  ])
  expect(strings).toEqual(['M0 0 L1 1'])
  expect(used[3]).toBe(2) // two roots
  expect(used[5]).toBe(0) // both reference string 0
  expect(used[14]).toBe(0)
})

test('nests groups with their transform ops and child count', () => {
  const { used } = compile([
    node(NodeType.Group, { transform: [{ translateX: 10 }, { scale: 2 }] }, [
      node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }),
    ]),
  ])
  expect(used[3]).toBe(1) // one root
  expect(used[4]).toBe(Kind.Group)
  expect(used[5]).toBe(2) // two ops
  expect(Array.from(used.subarray(6, 12))).toEqual([0, 10, 0, 1, 2, 2])
  expect(used[12]).toBe(1) // one child
  expect(used[13]).toBe(Kind.Rect)
})

test('multiplies group opacity into the child alpha', () => {
  const { used } = compile([
    node(NodeType.Group, { opacity: 0.5 }, [
      node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1, opacity: 0.5 }),
    ]),
  ])
  // group(kind ops=0 children=1) rect(kind x y w h) paint(color flags sw cap
  // join alpha)
  expect(used[17]).toBeCloseTo(0.25)
})

// The invariant the native dedupe key rests on: strings are indices, so the
// words alone cannot tell a content change apart. See cpp/SceneHash.hpp.
test('a text-only change leaves the word buffer byte-identical', () => {
  const usedBytes = (buffer: ArrayBuffer) =>
    new Uint8Array(buffer).slice(0, new Float64Array(buffer)[1]! * 8)
  const writer = new SceneWriter()
  const props = { x: 1, y: 2, fontSize: 16 }
  const first = compileScene([node(NodeType.Text, { ...props, text: '1' })], writer)
  const firstWords = usedBytes(first.buffer)
  const firstStrings = first.strings.slice()
  const second = compileScene([node(NodeType.Text, { ...props, text: '2' })], writer)
  expect(usedBytes(second.buffer)).toEqual(firstWords)
  expect(second.strings).not.toEqual(firstStrings)
})

test('reuses the writer across compiles without leaking state', () => {
  const writer = new SceneWriter()
  const first = compileScene([node(NodeType.Path, { path: 'M0 0' })], writer)
  expect(first.strings).toEqual(['M0 0'])
  const second = compileScene([node(NodeType.Rect, { x: 0 })], writer)
  expect(second.strings).toEqual([])
  expect(second.values).toEqual([])
  expect(new Float64Array(second.buffer)[3]).toBe(1)
})
