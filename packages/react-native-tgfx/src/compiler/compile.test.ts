import { expect, test } from 'bun:test'
import { NodeType, type Node } from '../reconciler/types'
import { compileScene } from './compile'
import { Kind, SCENE_VERSION, SceneWriter } from './writer'

const node = (type: unknown, props: object, children: Node[] = []): Node =>
  ({ type, props, children } as Node)

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
  // The literal carries the current value, not a placeholder: it is what native
  // renders until the first setValues lands.
  expect(used[5]).toBe(7)
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

test('keeps an animated group opacity as a live alpha slot', () => {
  const fade = sharedValue(0.4)
  const { used, values } = compile([
    node(NodeType.Group, { opacity: fade }, [
      node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }),
    ]),
  ])
  expect(values).toEqual([fade])
  // group(kind ops=0 children=1) rect(kind x y w h) paint(... alpha at 17)
  expect(used[17]).toBeCloseTo(0.4)
  const patchStart = used[2]!
  expect(used[patchStart]).toBe(1)
  expect(used[patchStart + 1]).toBe(17)
  expect(used[patchStart + 2]).toBe(0)
})

test('snapshots the product when two opacities in one chain are animated', () => {
  const { values, used } = compile([
    node(NodeType.Group, { opacity: sharedValue(0.5) }, [
      node(NodeType.Rect, {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        opacity: sharedValue(0.5),
      }),
    ]),
  ])
  expect(values).toEqual([])
  expect(used[17]).toBeCloseTo(0.25)
})

test('keeps an animated <Paint opacity> as a live alpha slot', () => {
  const fade = sharedValue(0.4)
  const { used, values } = compile([
    node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }, [
      node(NodeType.Paint, { opacity: fade }),
    ]),
  ])
  expect(values).toEqual([fade])
  const patchStart = used[2]!
  expect(used[patchStart]).toBe(1)
  expect(used[patchStart + 1]).toBe(14) // the rect's alpha word
})

test('folds <Paint opacity> into the alpha', () => {
  const { used } = compile([
    node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1, opacity: 0.5 }, [
      node(NodeType.Paint, { opacity: 0.25 }),
    ]),
  ])
  // rect(kind x y w h) paint(color flags sw cap join alpha)
  expect(used[14]).toBeCloseTo(0.25)
})

test('inherits <Paint opacity> from a group into its children', () => {
  const { used } = compile([
    node(NodeType.Group, {}, [
      node(NodeType.Paint, { opacity: 0.5 }),
      node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1, opacity: 0.5 }),
    ]),
  ])
  expect(used[17]).toBeCloseTo(0.25)
})

test('writes an alpha word for images so they inherit group opacity', () => {
  const { used } = compile([
    node(NodeType.Group, { opacity: 0.5 }, [
      node(NodeType.Image, { x: 0, y: 0, width: 1, height: 1, image: 'a' }),
    ]),
  ])
  // header(3) rootCount group(kind ops children) image(kind x y w h src fit
  // alpha) + patch table (count only)
  expect(used.length).toBe(3 + 1 + 3 + 8 + 1)
  expect(used[13]).toBe(1) // fit: contain
  expect(used[14]).toBeCloseTo(0.5)
})

test('patches the image alpha word when the group opacity is animated', () => {
  const fade = sharedValue(0.4)
  const { used, values } = compile([
    node(NodeType.Group, { opacity: fade }, [
      node(NodeType.Image, { x: 0, y: 0, width: 1, height: 1, image: 'a' }),
    ]),
  ])
  expect(values).toEqual([fade])
  const patchStart = used[2]!
  expect(patchStart).toBe(15) // the alpha word is the image node's last
  expect(used[patchStart + 1]).toBe(14)
})

// The invariant the native dedupe key rests on: strings are indices, so the
// words alone cannot tell a content change apart. See cpp/SceneHash.hpp.
test('a text-only change leaves the word buffer byte-identical', () => {
  const usedBytes = (buffer: ArrayBuffer) =>
    new Uint8Array(buffer).slice(0, new Float64Array(buffer)[1]! * 8)
  const writer = new SceneWriter()
  const props = { x: 1, y: 2, fontSize: 16 }
  const first = compileScene(
    [node(NodeType.Text, { ...props, text: '1' })],
    writer
  )
  const firstWords = usedBytes(first.buffer)
  const firstStrings = first.strings.slice()
  const second = compileScene(
    [node(NodeType.Text, { ...props, text: '2' })],
    writer
  )
  expect(usedBytes(second.buffer)).toEqual(firstWords)
  expect(second.strings).not.toEqual(firstStrings)
})

// Golden encoding: paint-bearing children add paint but never enter the stream.
const MIXED_GROUP_WORDS = [
  4, 60, 57, 1, 0, 2, 2, 1.5707963267948966, 0, 3, 0.5, 0, 2, 0, 1, 4,
  0.5235987755982988, 0, 1, 1, 0, 0, 1, 1, 4294901760, 3, 3, 0, 0, 1, 1, 1, 2,
  5, 2, 4294967295, 4278190080, 0, 1, 2, 3, 4, 5, 4294901760, 3, 3, 0, 0, 1, 1,
  1, 2, 5, 2, 4294967295, 4278190080, 0, 1, 10, 0,
]

test('a group draws only drawing children, the rest are paint', () => {
  const spin = sharedValue(0.5)
  const transform = [{ rotate: '90deg' }, { skewX: spin }]
  const { used, values } = compile([
    node(NodeType.Group, { transform }, [
      node(NodeType.Paint, { color: 'red', style: 'stroke', strokeWidth: 3 }, [
        node(NodeType.LinearGradient, {
          start: { x: 0, y: 0 },
          end: { x: 10, y: 10 },
          colors: ['#ff0000', '#0000ff'],
        }),
      ]),
      node(NodeType.RadialGradient, {
        cx: 1,
        cy: 2,
        r: 5,
        colors: ['white', 'black'],
      }),
      node(NodeType.Group, { transform: [{ skewY: '30deg' }] }, [
        node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }),
      ]),
      node(NodeType.Rect, { x: 2, y: 3, width: 4, height: 5 }),
    ]),
  ])
  expect(used[12]).toBe(2) // the <Paint> and gradient children are not drawn
  expect(Array.from(used)).toEqual(MIXED_GROUP_WORDS)
  expect(values).toEqual([spin])
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

test('a constant shared value renders at its value, not at zero', () => {
  const opacity = sharedValue(1)
  const { used } = compile([
    node(NodeType.Group, { opacity }, [
      node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }),
    ]),
  ])
  // A shared value that never changes never gets a setValues, so a zero literal
  // would leave the group permanently invisible.
  expect(used[17]).toBeCloseTo(1)
})

test('a non-finite shared value falls back rather than writing NaN', () => {
  const { used } = compile([
    node(NodeType.Circle, { cx: sharedValue(Number.NaN), cy: 5, r: 1 }),
  ])
  expect(used[5]).toBe(0)
})

// The engine draws a compiled paint as-is, so a `<Line>` — which has no
// interior to fill — has to carry the stroke style and its width from here.
test('compiles a line as a stroke that keeps its stroke width', () => {
  const { used } = compile([
    node(NodeType.Line, { x1: 0, y1: 0, x2: 10, y2: 5, strokeWidth: 4 }),
  ])
  expect(used[4]).toBe(Kind.Line)
  expect(used[10]! & 1).toBe(1)
  expect(used[11]).toBe(4)
})

test('leaves a non-line node filled by default', () => {
  const { used } = compile([node(NodeType.Rect, { x: 0, y: 0 })])
  expect(used[10]! & 1).toBe(0)
})

// Paint block layout, mirrored by readPaint in cpp/TgfxScene.cpp:
// color, flags, strokeWidth, cap, join, alpha, shader.
const RECT_STROKE_WIDTH_WORD = 11
const RECT_ALPHA_WORD = 14

test('animates strokeWidth through a patch slot', () => {
  const width = sharedValue(6)
  const { used, values } = compile([
    node(NodeType.Rect, { x: 1, y: 2, width: 3, height: 4, strokeWidth: width }),
  ])
  expect(values).toEqual([width])
  const patchStart = used[2]!
  expect(used[patchStart]).toBe(1)
  expect(used[patchStart + 1]).toBe(RECT_STROKE_WIDTH_WORD)
  expect(used[patchStart + 2]).toBe(0)
  expect(used[RECT_STROKE_WIDTH_WORD]).toBe(6)
})

test('animates a strokeWidth inherited from a group', () => {
  const width = sharedValue(6)
  const { used, values } = compile([
    node(NodeType.Group, { strokeWidth: width }, [
      node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }),
    ]),
  ])
  expect(values).toEqual([width])
  // group(kind ops=0 children=1) rect(kind x y w h) paint(color flags sw ...)
  const strokeWidthWord = 14
  const patchStart = used[2]!
  expect(used[patchStart]).toBe(1)
  expect(used[patchStart + 1]).toBe(strokeWidthWord)
  expect(used[strokeWidthWord]).toBe(6)
})

test('keeps a static strokeWidth a literal with no patch', () => {
  const { used } = compile([
    node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1, strokeWidth: 6 }),
  ])
  expect(used[RECT_STROKE_WIDTH_WORD]).toBe(6)
  expect(used[used[2]!]).toBe(0)
})

// nextAnim matches patches positionally, so the reader only stays in step if
// strokeWidth stays one word and its patch keeps ascending word order.
test('an animated strokeWidth costs no extra word and stays ordered', () => {
  const props = { x: 0, y: 0, width: 1, height: 1, opacity: sharedValue(0.5) }
  const staticScene = compile([node(NodeType.Rect, props)])
  const animated = compile([
    node(NodeType.Rect, { ...props, strokeWidth: sharedValue(6) }),
  ])
  const patchStart = staticScene.used[2]!
  expect(animated.used[2]).toBe(patchStart)
  expect(staticScene.used[patchStart]).toBe(1)
  expect(animated.used[patchStart]).toBe(2)
  expect(animated.used[patchStart + 1]).toBe(RECT_STROKE_WIDTH_WORD)
  expect(animated.used[patchStart + 3]).toBe(RECT_ALPHA_WORD)
})
