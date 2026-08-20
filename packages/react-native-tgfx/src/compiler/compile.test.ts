import { expect, mock, test } from 'bun:test'

// createHandle reaches for runOnJS; this file has no other reanimated dependency.
mock.module('react-native-reanimated', () => ({}))
import { NodeType, type Node } from '../reconciler/types'
import { createHandle } from '../imperative'
import { compileScene } from './compile'
import { Kind, SCENE_VERSION, SceneWriter } from './writer'

const node = (type: unknown, props: object, children: Node[] = []): Node =>
  ({ type, props, children }) as Node

const sharedValue = (value: number) => ({
  value,
  _isReanimatedSharedValue: true as const,
})

const handle = (id: number) => ({ handle: id })

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
  // header(3) rootCount kind x y w h + paint(7) + patch table (count only)
  expect(used.length).toBe(3 + 1 + 5 + 7 + 2)
  expect(Array.from(used.subarray(3, 9))).toEqual([1, Kind.Rect, 1, 2, 3, 4])
  expect(used[9]).toBe(0xffff0000) // packed AARRGGBB
  expect(used[10]).toBe(2) // fill + antiAlias
  expect(used[15]).toBe(-1) // no shader
})

test('a miter limit costs a flag bit and a word, and nothing when unset', () => {
  const shape = (strokeMiter?: number) =>
    compile([
      node(NodeType.Rect, {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        style: 'stroke',
        strokeJoin: 'miter',
        strokeMiter,
      }),
    ])
  const plain = shape()
  expect(plain.used[10]).toBe(1 | 2)
  const limited = shape(10)
  expect(limited.used[10]).toBe(1 | 2 | 16)
  // colour flags | width cap join miter alpha
  expect(Array.from(limited.used.subarray(11, 16))).toEqual([1, 0, 0, 10, 1])
  expect(limited.used.length).toBe(plain.used.length + 1)
})

test('records a patch for every animated field, and reuses one slot', () => {
  const radius = sharedValue(7)
  const { used, values } = compile([
    node(NodeType.Circle, { cx: radius, cy: 5, r: radius }),
  ])
  expect(values).toEqual([radius])
  const patchStart = used[2]
  expect(used[patchStart]).toBe(2)
  expect(used[patchStart + 1]).toBe(5)
  expect(used[patchStart + 2]).toBe(0)
  expect(used[patchStart + 3]).toBe(7)
  expect(used[patchStart + 4]).toBe(0)
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
  expect(used[15]).toBe(0)
})

test('a plain path writes one zero effect word, and effects ride flag bits', () => {
  const plain = compile([node(NodeType.Path, { path: 'M0 0 L1 1' })])
  expect(plain.used[5]).toBe(0) // path string
  expect(plain.used[6]).toBe(0) // no effects, no fill type

  const evenOdd = compile([
    node(NodeType.Path, { path: 'M0 0 L1 1', fillType: 'evenOdd' }),
  ])
  expect(evenOdd.used[6]).toBe(8)
  expect(evenOdd.used.length).toBe(plain.used.length)

  const trimmed = compile([
    node(NodeType.Path, { path: 'M0 0 L1 1', start: 0.2, end: 0.8 }),
  ])
  expect(Array.from(trimmed.used.subarray(6, 9))).toEqual([1, 0.2, 0.8])

  const dashed = compile([
    {
      ...node(NodeType.Path, { path: 'M0 0 L1 1' }),
      children: [
        node(NodeType.DashPathEffect, { intervals: [10, 5], phase: 3 }),
      ],
    },
  ])
  // flags | count 10 5 phase
  expect(Array.from(dashed.used.subarray(6, 11))).toEqual([2, 2, 10, 5, 3])

  const rounded = compile([
    {
      ...node(NodeType.Path, { path: 'M0 0 L1 1' }),
      children: [node(NodeType.CornerPathEffect, { r: 4 })],
    },
  ])
  expect(Array.from(rounded.used.subarray(6, 8))).toEqual([4, 4])
})

test('an animated trim and dash phase take value slots', () => {
  const start = sharedValue(0.1)
  const phase = sharedValue(2)
  const { used, values } = compile([
    {
      ...node(NodeType.Path, { path: 'M0 0 L1 1', start, end: 0.9 }),
      children: [node(NodeType.DashPathEffect, { intervals: [4, 4], phase })],
    },
  ])
  expect(values).toEqual([start, phase])
  const patchStart = used[2]
  expect(used[patchStart]).toBe(2)
  expect(used[patchStart + 1]).toBe(7) // the start word
  expect(used[patchStart + 2]).toBe(0)
  expect(used[patchStart + 4]).toBe(1)
})

test('a luma filter is one word and needs no block', () => {
  const filtered = (child: Node) =>
    compile([
      {
        ...node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }),
        children: [child],
      },
    ])

  // colour flags | width cap join alpha | blend colourKind ...
  const luma = filtered(node(NodeType.Luma, {}))
  expect(luma.used[10]).toBe(2 | 4) // antiAlias + the filter block
  expect(Array.from(luma.used.subarray(15, 18))).toEqual([3, 2, -1])
})

test('a drop shadow packs shadowOnly and inner into one flags word', () => {
  const shadow = (props: Record<string, unknown>) =>
    compile([
      {
        ...node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }),
        children: [
          node(NodeType.DropShadow, { dx: 1, dy: 2, blur: 3, ...props }),
        ],
      },
    ])
  const at = (r: ReturnType<typeof shadow>) => r.used[r.used.length - 4]
  expect(at(shadow({}))).toBe(0)
  expect(at(shadow({ shadowOnly: true }))).toBe(1)
  expect(at(shadow({ inner: true }))).toBe(2)
  expect(at(shadow({ shadowOnly: true, inner: true }))).toBe(3)
})

test('a mask writes its mode, then the mask list, then the content list', () => {
  const mask = (props: Record<string, unknown> = {}) =>
    compile([
      {
        ...node(NodeType.Mask, props),
        children: [
          {
            ...node(NodeType.MaskSource, {}),
            children: [node(NodeType.Circle, { cx: 1, cy: 2, r: 3 })],
          },
          node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }),
        ],
      },
    ])

  const alpha = mask()
  expect(alpha.used[4]).toBe(Kind.Mask)
  expect(alpha.used[5]).toBe(0) // alpha mode
  expect(alpha.used[6]).toBe(1) // one mask node
  expect(alpha.used[7]).toBe(Kind.Circle)
  expect(mask({ mode: 'luminance' }).used[5]).toBe(1)
})

test('a mask is a matte: it takes neither the inherited opacity nor the paint', () => {
  const { used } = compile([
    node(NodeType.Group, { opacity: 0.5 }, [
      {
        ...node(NodeType.Mask, {}),
        children: [
          {
            ...node(NodeType.MaskSource, {}),
            children: [
              node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }),
            ],
          },
          node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }),
        ],
      },
    ]),
  ])
  // group | mask kind mode maskCount | mask rect (12 words) | contentCount | content rect
  expect(used[7]).toBe(Kind.Mask)
  expect(used[10]).toBe(Kind.Rect)
  expect(used[20]).toBe(1) // the matte keeps full alpha
  expect(used[23]).toBe(Kind.Rect)
  expect(used[33]).toBe(0.5) // the content takes the group's opacity
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

test('a plain group writes exactly what it always did', () => {
  const plain = compile([
    node(NodeType.Group, { transform: [{ translateX: 10 }] }, [
      node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }),
    ]),
  ])
  expect(plain.used[4]).toBe(Kind.Group)
  // Only a group that clips or layers takes the extended kind, and only it costs words.
  const clipped = compile([
    node(
      NodeType.Group,
      {
        transform: [{ translateX: 10 }],
        clip: { x: 1, y: 2, width: 3, height: 4 },
      },
      [node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 })]
    ),
  ])
  expect(clipped.used[4]).toBe(Kind.GroupLayer)
  expect(clipped.used.length).toBe(plain.used.length + 6)
})

test('a group clip writes its kind and geometry, and a path clip interns', () => {
  const rect = compile([
    node(NodeType.Group, { clip: { x: 1, y: 2, width: 3, height: 4 } }, []),
  ])
  // kind | opCount | flags | clipKind x y w h | childCount
  expect(Array.from(rect.used.subarray(4, 12))).toEqual([
    13, 0, 1, 1, 1, 2, 3, 4,
  ])

  const rounded = compile([
    node(
      NodeType.Group,
      { clip: { x: 1, y: 2, width: 3, height: 4, r: 5 } },
      []
    ),
  ])
  expect(Array.from(rounded.used.subarray(6, 14))).toEqual([
    1, 2, 1, 2, 3, 4, 5, 5,
  ])

  const path = compile([
    node(NodeType.Group, { clip: 'M0 0 L1 1', invertClip: true }, []),
  ])
  expect(path.strings).toEqual(['M0 0 L1 1'])
  expect(Array.from(path.used.subarray(6, 9))).toEqual([1 | 2, 3, 0])
})

test('a layer carries the group alpha instead of pushing it into the children', () => {
  const layered = compile([
    node(NodeType.Group, { layer: true, opacity: 0.5 }, [
      node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }),
    ]),
  ])
  // flags = layer, then the layer alpha, then one child whose own alpha is untouched.
  expect(layered.used[6]).toBe(4)
  expect(layered.used[7]).toBe(0.5)
  expect(layered.used[8]).toBe(1)
  expect(layered.used[9]).toBe(Kind.Rect)
  expect(layered.used[layered.used.length - 4]).toBe(1)

  const flattened = compile([
    node(NodeType.Group, { opacity: 0.5 }, [
      node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }),
    ]),
  ])
  expect(flattened.used[flattened.used.length - 4]).toBe(0.5)
})

test('a nested layer applies the inherited opacity once, not twice', () => {
  const nested = compile([
    node(NodeType.Group, { opacity: 0.5 }, [
      node(NodeType.Group, { layer: true }, [
        node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }),
      ]),
    ]),
  ])
  // The whole inherited alpha rides the layer; the child stays at 1 rather than squaring it.
  expect(nested.used[10]).toBe(0.5)
  expect(nested.used[nested.used.length - 4]).toBe(1)

  const both = compile([
    node(NodeType.Group, { opacity: 0.5 }, [
      node(NodeType.Group, { layer: true, opacity: 0.5 }, [
        node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }),
      ]),
    ]),
  ])
  expect(both.used[10]).toBe(0.25)
  expect(both.used[both.used.length - 4]).toBe(1)
})

test('multiplies group opacity into the child alpha', () => {
  const { used } = compile([
    node(NodeType.Group, { opacity: 0.5 }, [
      node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1, opacity: 0.5 }),
    ]),
  ])
  // group(kind ops=0 children=1) rect(kind x y w h) paint(color flags sw cap join alpha)
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

// An image node: kind x y w h handle fit sampling srcFlag, then a full paint.
const IMAGE_WORDS = 9 + 7
const ALPHA_AT = 3 + 1 + 3 + 14

test('writes an alpha word for images so they inherit group opacity', () => {
  const { used, strings } = compile([
    node(NodeType.Group, { opacity: 0.5 }, [
      node(NodeType.Image, {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        image: handle(9),
      }),
    ]),
  ])
  expect(strings).toEqual([])
  expect(used.length).toBe(3 + 1 + 3 + IMAGE_WORDS + 2)
  expect(used[12]).toBe(9) // the native handle, not a string index
  expect(used[13]).toBe(1) // fit: contain
  expect(used[14]).toBe(1) // sampling: linear
  expect(used[15]).toBe(0) // no source rect
  expect(used[ALPHA_AT]).toBeCloseTo(0.5)
})

test('patches the image alpha word when the group opacity is animated', () => {
  const fade = sharedValue(0.4)
  const { used, values } = compile([
    node(NodeType.Group, { opacity: fade }, [
      node(NodeType.Image, {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        image: handle(1),
      }),
    ]),
  ])
  expect(values).toEqual([fade])
  const patchStart = used[2]!
  expect(used[patchStart + 1]).toBe(ALPHA_AT)
})

test('encodes the full fit and sampling sets, and a source rect', () => {
  const { used } = compile([
    node(NodeType.Image, {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      image: handle(4),
      fit: 'scaleDown',
      sampling: 'mipmap',
      rect: { x: 8, y: 16, width: 32, height: 64 },
    }),
  ])
  expect(Array.from(used.subarray(9, 17))).toEqual([4, 6, 2, 1, 8, 16, 32, 64])
})

test('a disposed handle compiles to 0 rather than throwing mid-commit', () => {
  const dead = {
    get handle(): number {
      throw new Error('disposed')
    },
  }
  const { used } = compile([
    node(NodeType.Image, { x: 0, y: 0, width: 1, height: 1, image: dead }),
  ])
  expect(used[9]).toBe(0)
})

test('an <ImageShader> child becomes the shape shader, with tiling', () => {
  const { used } = compile([
    node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }, [
      node(NodeType.ImageShader, {
        image: handle(3),
        tx: 'repeat',
        ty: 'mirror',
        sampling: 'nearest',
      }),
    ]),
  ])
  // kind x y w h + color flags sw cap join alpha, then the shader.
  expect(Array.from(used.subarray(15, 21))).toEqual([7, 3, 1, 2, 0, 0])
})

test('an <ImageShader> rect adds the fit that maps the image into it', () => {
  const { used } = compile([
    node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }, [
      node(NodeType.ImageShader, {
        image: handle(3),
        rect: { x: 1, y: 2, width: 30, height: 40 },
        fit: 'cover',
      }),
    ]),
  ])
  expect(Array.from(used.subarray(19, 26))).toEqual([1, 1, 1, 2, 30, 40, 2])
})

test('a <CameraFrame> carries no geometry, defaults to cover, and nests children', () => {
  const { used } = compile([
    node(NodeType.CameraFrame, { image: handle(5) }, [
      node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }),
    ]),
  ])
  // rootCount kind handle fit sampling turns mirror + paint(7) + childCount.
  expect(Array.from(used.subarray(3, 10))).toEqual([
    1,
    Kind.CameraFrame,
    5,
    2, // fit: cover, not the 'contain' every other image node defaults to
    1, // sampling: linear
    0, // no rotation
    0, // not mirrored
  ])
  expect(used[17]).toBe(1) // one child
  expect(used[18]).toBe(Kind.Rect)
})

test('a <CameraFrame> turns a rotation into clockwise quarter turns', () => {
  const turns = (rotation: unknown) =>
    compile([node(NodeType.CameraFrame, { image: handle(1), rotation })])
      .used[8]
  expect(turns(0)).toBe(0)
  expect(turns(90)).toBe(1)
  expect(turns(180)).toBe(2)
  expect(turns(270)).toBe(3)
  expect(turns(-90)).toBe(3)
  expect(turns(360)).toBe(0)
  expect(turns(undefined)).toBe(0)
})

test('a <CameraFrame> child inherits its opacity, like a group', () => {
  const { used } = compile([
    node(NodeType.CameraFrame, { image: handle(1), opacity: 0.5 }, [
      node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }),
    ]),
  ])
  expect(used[15]).toBeCloseTo(0.5)
  expect(used[28]).toBeCloseTo(0.5)
})

// Strings are indices, so the words alone cannot tell a content change apart. See cpp/SceneHash.hpp.
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

test('a text node carries its font block and its paragraph block', () => {
  const { used, strings } = compile([
    node(NodeType.Text, {
      x: 1,
      y: 2,
      text: 'hi',
      fontSize: 16,
      fontFamily: 'PT Serif',
      fontWeight: 'bold',
      fontStyle: 'italic',
      letterSpacing: 1.5,
      width: 120,
      textAlign: 'center',
      lineHeight: 22,
      maxLines: 2,
      ellipsis: '…',
    }),
  ])
  expect(strings).toEqual(['PT Serif', 'hi', '', '…'])
  // x y size | family weight italic spacing | run: count text family weight italic spacing size hasColor color | width align lh maxLines ellipsis
  expect(Array.from(used.subarray(5, 25))).toEqual([
    1, 2, 16, 0, 700, 1, 1.5, 1, 1, 2, 0, 0, 0, 0, 0, 0, 120, 1, 22, 2,
  ])
  expect(used[25]).toBe(3) // ellipsis
})

test('an omitted font block defaults to normal, upright and unwrapped', () => {
  const { used, strings } = compile([
    node(NodeType.Text, { x: 0, y: 0, text: 'hi' }),
  ])
  expect(strings).toEqual(['', 'hi'])
  expect(Array.from(used.subarray(7, 25))).toEqual([
    14, 0, 400, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ])
})

test('the font style word packs italic and the two faux bits', () => {
  const style = (p: Record<string, unknown>) =>
    compile([node(NodeType.Text, { x: 0, y: 0, text: 'hi', ...p })]).used[10]
  expect(style({})).toBe(0)
  expect(style({ fontStyle: 'italic' })).toBe(1)
  expect(style({ fauxBold: true })).toBe(2)
  expect(style({ fauxItalic: true })).toBe(4)
  expect(style({ fontStyle: 'italic', fauxBold: true, fauxItalic: true })).toBe(
    7
  )
})

test('a text path carries the path, the text and the font block', () => {
  const { used, strings } = compile([
    node(NodeType.TextPath, {
      path: 'M0 0 L10 0',
      text: 'hi',
      fontSize: 12,
      fontFamily: 'PT Serif',
      startOffset: 4,
    }),
  ])
  expect(strings).toEqual(['M0 0 L10 0', 'PT Serif', 'hi', ''])
  expect(Array.from(used.subarray(3, 11))).toEqual([
    1,
    Kind.TextPath,
    0,
    12,
    1,
    400,
    0,
    0,
  ])
  expect(Array.from(used.subarray(11, 19))).toEqual([1, 2, 3, 0, 0, 0, 0, 0])
  expect(used[19]).toBe(0) // colour
  expect(used[20]).toBe(4) // startOffset
})

// Golden encoding: paint-bearing children add paint but never enter the stream. Word 0 is the version.
const MIXED_GROUP_WORDS = [
  SCENE_VERSION,
  63,
  59,
  1,
  0,
  2,
  2,
  1.5707963267948966,
  0,
  3,
  0.5,
  0,
  2,
  0,
  1,
  4,
  0.5235987755982988,
  0,
  1,
  1,
  0,
  0,
  1,
  1,
  4294901760,
  3,
  3,
  0,
  0,
  1,
  1,
  1,
  2,
  5,
  0,
  2,
  4294967295,
  4278190080,
  0,
  1,
  2,
  3,
  4,
  5,
  4294901760,
  3,
  3,
  0,
  0,
  1,
  1,
  1,
  2,
  5,
  0,
  2,
  4294967295,
  4278190080,
  0,
  1,
  10,
  0,
  0,
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
  expect(used[17]).toBeCloseTo(1)
})

test('a non-finite shared value falls back rather than writing NaN', () => {
  const { used } = compile([
    node(NodeType.Circle, { cx: sharedValue(Number.NaN), cy: 5, r: 1 }),
  ])
  expect(used[5]).toBe(0)
})

// A `<Line>` has no interior to fill, so it has to carry the stroke style and width from here.
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

// Paint block, mirrored by readPaint: color, flags, strokeWidth, cap, join, alpha, shader.
const RECT_STROKE_WIDTH_WORD = 11
const RECT_ALPHA_WORD = 14

test('animates strokeWidth through a patch slot', () => {
  const width = sharedValue(6)
  const { used, values } = compile([
    node(NodeType.Rect, {
      x: 1,
      y: 2,
      width: 3,
      height: 4,
      strokeWidth: width,
    }),
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

// nextAnim matches patches positionally, so strokeWidth must stay one word in ascending order.
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

test('an animated shader uniform gets a slot, a static one stays a literal', () => {
  const level = sharedValue(0.75)
  const source = `
uniform float uLevel;
uniform float2 uSize;
half4 main(float2 p) {
  return half4(uLevel, p.x / uSize.x, 0.0, 1.0);
}
`
  const { used, values } = compile([
    node(NodeType.Rect, { x: 0, y: 0, width: 4, height: 4 }, [
      node(NodeType.Shader, {
        source,
        uniforms: { uLevel: level, uSize: [8, 9] },
      }),
    ]),
  ])
  expect(values).toEqual([level])

  const patchStart = used[2]
  expect(used[patchStart]).toBe(1)
  const at = used[patchStart + 1]
  expect(used[at]).toBe(0.75)
  expect(used[patchStart + 2]).toBe(0)
  expect(Array.from(used.subarray(at + 3, at + 5))).toEqual([8, 9])
})

test('a uniform vector may mix animated and static components', () => {
  const x = sharedValue(3)
  const { used, values } = compile([
    node(NodeType.Rect, { x: 0, y: 0, width: 4, height: 4 }, [
      node(NodeType.Shader, {
        source:
          'uniform float2 uAt;\nhalf4 main(float2 p) { return half4(uAt, 0.0, 1.0); }',
        uniforms: { uAt: [x, 9] },
      }),
    ]),
  ])
  expect(values).toEqual([x])
  const patchStart = used[2]
  expect(used[patchStart]).toBe(1)
  const at = used[patchStart + 1]
  expect(used[at]).toBe(3)
  expect(used[at + 1]).toBe(9)
})

// A one-sided bump is green here and a blank canvas on device, so the two constants are compared.
test('the native wire version matches SCENE_VERSION', async () => {
  const hpp = await Bun.file(
    new URL('../../cpp/TgfxScene.hpp', import.meta.url)
  ).text()
  const found = hpp.match(/kSceneVersion = (\d+);/)?.[1]
  expect(found).toBe(String(SCENE_VERSION))
})

test('a Fill writes its paint and no geometry', () => {
  const { used } = compile([node(NodeType.Fill, { color: '#ff0000' })])
  expect(used.length).toBe(3 + 1 + 1 + 7 + 2)
  expect(used[4]).toBe(Kind.Fill)
  expect(used[5]).toBe(0xffff0000)
})

test('a Fill carries a runtime shader like any other drawing', () => {
  const t = sharedValue(0)
  const { used, values } = compile([
    node(NodeType.Fill, {}, [
      node(NodeType.Shader, {
        source:
          'uniform float uT;\nhalf4 main(float2 p) { return half4(uT, 0.0, 0.0, 1.0); }',
        uniforms: { uT: t },
      }),
    ]),
  ])
  expect(values).toEqual([t])
  expect(used[4]).toBe(Kind.Fill)
})

const CHILD_SOURCE = `
uniform shader tex;
half4 main(float2 p) { return tex.eval(p); }
`

test('a shader child of a <Shader> is written after its uniforms', () => {
  const { used } = compile([
    node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }, [
      node(NodeType.Shader, { source: CHILD_SOURCE }, [
        node(NodeType.ImageShader, { image: { handle: 77 } }),
      ]),
    ]),
  ])
  // Shader code starts at 15: kind 6, body, preamble, 0 functions, 0 uniforms, then the child count.
  expect([...used.slice(15, 23)]).toEqual([6, 0, 1, 0, 0, 1, 7, 77])
})

// The rewritten body calls TGFX_CHILD_0, which native cannot emit with no child bound.
test('a child declaration with no shader child throws', () => {
  expect(() =>
    compile([
      node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }, [
        node(NodeType.Shader, { source: CHILD_SOURCE }),
      ]),
    ])
  ).toThrow(/declares 1 'uniform shader' \(tex\) but 0/)
})

test('more shader children than declarations throws', () => {
  expect(() =>
    compile([
      node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }, [
        node(NodeType.Shader, { source: CHILD_SOURCE }, [
          node(NodeType.ImageShader, { image: { handle: 1 } }),
          node(NodeType.ImageShader, { image: { handle: 2 } }),
        ]),
      ]),
    ])
  ).toThrow(/but 2 shader children were given/)
})

// Filter block, mirrored by readFilters: blend mode, then colour and image filter (-1 = none).
const RECT_FLAGS_WORD = 10
const RECT_FILTERS_WORD = 15

test('an unfiltered paint writes no filter block and no flag bit', () => {
  const { used } = compile([
    node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }),
  ])
  expect(used[RECT_FLAGS_WORD]! & 4).toBe(0)
  expect(used[RECT_FILTERS_WORD]).toBe(-1)
  expect(used.length).toBe(3 + 1 + 5 + 7 + 2)
})

test('an explicit srcOver blend mode is not written either', () => {
  const { used } = compile([
    node(NodeType.Rect, {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      blendMode: 'srcOver',
    }),
  ])
  expect(used[RECT_FLAGS_WORD]! & 4).toBe(0)
  expect(used.length).toBe(3 + 1 + 5 + 7 + 2)
})

test('writes a blend mode as its tgfx enum index', () => {
  const { used } = compile([
    node(NodeType.Rect, {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      blendMode: 'multiply',
    }),
  ])
  expect(used[RECT_FLAGS_WORD]! & 4).toBe(4)
  expect(
    Array.from(used.subarray(RECT_FILTERS_WORD, RECT_FILTERS_WORD + 4))
  ).toEqual([24, -1, -1, -1])
})

test('writes a <ColorMatrix> child as 20 matrix words', () => {
  const matrix = Array.from({ length: 20 }, (_, i) => i)
  const { used } = compile([
    node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }, [
      node(NodeType.ColorMatrix, { matrix }),
    ]),
  ])
  expect(used[RECT_FLAGS_WORD]! & 4).toBe(4)
  expect(used[RECT_FILTERS_WORD]).toBe(3) // srcOver
  expect(used[RECT_FILTERS_WORD + 1]).toBe(0) // matrix kind
  expect(
    Array.from(used.subarray(RECT_FILTERS_WORD + 2, RECT_FILTERS_WORD + 22))
  ).toEqual(matrix)
  expect(used[RECT_FILTERS_WORD + 22]).toBe(-1) // no image filter
})

test('a <ColorMatrix> that is not 20 numbers falls back to the identity', () => {
  const { used } = compile([
    node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }, [
      node(NodeType.ColorMatrix, { matrix: [1, 2, 3] }),
    ]),
  ])
  expect(
    Array.from(used.subarray(RECT_FILTERS_WORD + 2, RECT_FILTERS_WORD + 22))
  ).toEqual([1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0])
})

test('writes a <BlendColor> child as a packed colour and a mode', () => {
  const { used } = compile([
    node(NodeType.Circle, { cx: 0, cy: 0, r: 1 }, [
      node(NodeType.BlendColor, { color: '#ff0000', mode: 'screen' }),
    ]),
  ])
  const at = RECT_FILTERS_WORD - 1
  expect(Array.from(used.subarray(at, at + 5))).toEqual([
    3, 1, 0xffff0000, 14, -1,
  ])
})

test('writes a <Blur> child as sigmas and a tile mode, decal by default', () => {
  const { used } = compile([
    node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }, [
      node(NodeType.Blur, { blur: 4 }),
    ]),
  ])
  expect(
    Array.from(used.subarray(RECT_FILTERS_WORD, RECT_FILTERS_WORD + 6))
  ).toEqual([3, -1, 0, 4, 4, 3])
})

test('a per-axis <Blur> overrides the shared sigma', () => {
  const { used } = compile([
    node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }, [
      node(NodeType.Blur, { blur: 4, blurY: 9, tileMode: 'clamp' }),
    ]),
  ])
  expect(
    Array.from(used.subarray(RECT_FILTERS_WORD + 2, RECT_FILTERS_WORD + 6))
  ).toEqual([0, 4, 9, 0])
})

test('writes a <DropShadow> child with its offset, colour and shadowOnly flag', () => {
  const { used } = compile([
    node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }, [
      node(NodeType.DropShadow, {
        dx: 3,
        dy: 4,
        blur: 2,
        color: 'black',
        shadowOnly: true,
      }),
    ]),
  ])
  expect(
    Array.from(used.subarray(RECT_FILTERS_WORD, RECT_FILTERS_WORD + 9))
  ).toEqual([3, -1, 1, 3, 4, 2, 2, 0xff000000, 1])
})

test('inherits a filter from a <Group> into every descendant', () => {
  const { used } = compile([
    node(NodeType.Group, {}, [
      node(NodeType.Paint, { blendMode: 'multiply' }, [
        node(NodeType.Blur, { blur: 2 }),
      ]),
      node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }),
      node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }),
    ]),
  ])
  // group(kind, opCount, childCount) then two rects of kind + 4 geometry + 6 paint + 6 filter + 1.
  const first = 3 + 1 + 3 + 5 + 6
  const second = first + 6 + 1 + 11
  expect(Array.from(used.subarray(first, first + 4))).toEqual([24, -1, 0, 2])
  expect(Array.from(used.subarray(second, second + 4))).toEqual([24, -1, 0, 2])
})

test('two filters of the same class on one paint compose in order', () => {
  const { used } = compile([
    node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }, [
      node(NodeType.Blur, { blur: 2 }),
      node(NodeType.Blur, { blur: 7 }),
    ]),
  ])
  // blend | colourKind(none) | imageKind 2 = compose | blur 2 | blur 7
  expect(Array.from(used.subarray(15, 25))).toEqual([
    3, -1, 2, 0, 2, 2, 3, 0, 7, 7,
  ])

  // A colour filter declared first stays on the paint, which costs no offscreen:
  // blend | luma | blur | 2 | 2 | tile.
  const paintFirst = compile([
    node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }, [
      node(NodeType.Luma, {}),
      node(NodeType.Blur, { blur: 2 }),
    ]),
  ])
  expect(Array.from(paintFirst.used.subarray(15, 21))).toEqual([
    3, 2, 0, 2, 2, 3,
  ])

  // Declared after one, it joins the image chain instead — the only way it can
  // run *after* the blur, which is what the declaration order says.
  // blend | none | compose | blur | 2 | 2 | tile | colorFilter | luma
  const afterBlur = compile([
    node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }, [
      node(NodeType.Blur, { blur: 2 }),
      node(NodeType.Luma, {}),
    ]),
  ])
  expect(Array.from(afterBlur.used.subarray(15, 24))).toEqual([
    3, -1, 2, 0, 2, 2, 3, 3, 2,
  ])
})

test('alphaThreshold writes its own kind and defaults to a half', () => {
  const { used } = compile([
    node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }, [
      node(NodeType.AlphaThreshold, {}),
    ]),
  ])
  // blend | colourKind 3 | threshold | imageKind none
  expect(Array.from(used.subarray(15, 19))).toEqual([3, 3, 0.5, -1])

  const named = compile([
    node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }, [
      node(NodeType.AlphaThreshold, { threshold: 0.8 }),
    ]),
  ])
  expect(Array.from(named.used.subarray(15, 19))).toEqual([3, 3, 0.8, -1])
})

// The composition this exists for: blur an alpha, then cut it to a hard edge.
test('a blur followed by a threshold is one image chain', () => {
  const { used } = compile([
    node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }, [
      node(NodeType.Blur, { blur: 4 }),
      node(NodeType.AlphaThreshold, { threshold: 0.6 }),
    ]),
  ])
  // blend | none | compose | blur | 4 | 4 | tile | colorFilter | 3 | 0.6
  expect(Array.from(used.subarray(15, 25))).toEqual([
    3, -1, 2, 0, 4, 4, 3, 3, 3, 0.6,
  ])
})

test('a filter on the node itself overrides the one it inherits', () => {
  const { used } = compile([
    node(NodeType.Group, {}, [
      node(NodeType.Paint, {}, [node(NodeType.Blur, { blur: 2 })]),
      node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }, [
        node(NodeType.Blur, { blur: 7 }),
      ]),
    ]),
  ])
  const at = 3 + 1 + 3 + 5 + 6
  expect(Array.from(used.subarray(at, at + 6))).toEqual([3, -1, 0, 7, 7, 3])
})

test('spans become the run list, and the text prop steps aside', () => {
  const { used, strings } = compile([
    {
      ...node(NodeType.Text, { x: 0, y: 0, text: 'ignored', fontSize: 12 }),
      children: [
        node(NodeType.Span, { text: 'plain ' }),
        node(NodeType.Span, {
          text: 'bold',
          fontWeight: 700,
          color: '#ff0000',
          fontSize: 20,
        }),
      ],
    },
  ])
  expect(strings).toEqual(['', 'plain ', 'bold'])
  expect(used[12]).toBe(2)
  expect(Array.from(used.subarray(13, 21))).toEqual([1, 0, 0, 0, 0, 0, 0, 0])
  expect(Array.from(used.subarray(21, 29))).toEqual([
    2, 0, 700, 0, 0, 20, 1, 0xffff0000,
  ])
})

test('a span says whether it inherits the italic, forces it, or forces upright', () => {
  const runs = (fontStyle?: string) => {
    const { used } = compile([
      {
        ...node(NodeType.Text, { x: 0, y: 0, fontSize: 12 }),
        children: [node(NodeType.Span, { text: 'hi', fontStyle })],
      },
    ])
    return used[16]
  }
  expect(runs(undefined)).toBe(0)
  expect(runs('italic')).toBe(1)
  expect(runs('normal')).toBe(2)
})

test('a glyph node carries its ids and positions verbatim', () => {
  const { used, strings } = compile([
    node(NodeType.Glyphs, {
      x: 5,
      y: 6,
      fontSize: 18,
      fontFamily: 'PT Serif',
      glyphs: [
        { id: 40, x: 0, y: 0 },
        { id: 72, x: 11.5, y: -3 },
      ],
    }),
  ])
  expect(strings).toEqual(['PT Serif'])
  // x y size | family weight italic spacing | count, then (id, x, y) each
  expect(Array.from(used.subarray(4, 19))).toEqual([
    Kind.Glyphs,
    5,
    6,
    18,
    0,
    400,
    0,
    0,
    2,
    40,
    0,
    0,
    72,
    11.5,
    -3,
  ])
})

test('a literal four-channel colour packs into the colour word alone', () => {
  const { used } = compile([
    node(NodeType.Rect, {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      color: [1, 0, 0, 1],
    }),
  ])
  expect(used[9]).toBe(0xffff0000)
  expect(used[10]).toBe(2) // fill + antiAlias, no live-colour bit
  expect(used.length).toBe(3 + 1 + 5 + 7 + 2)
})

test('a live channel writes four patched colour words after the flags', () => {
  const green = sharedValue(0.5)
  const { used, values } = compile([
    node(NodeType.Rect, {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      color: [0, green, 0, 1],
    }),
  ])
  expect(values).toEqual([green])
  expect(used[9]).toBe(0xff008000)
  expect(used[10]).toBe(2 | 8)
  expect(Array.from(used.subarray(11, 15))).toEqual([0, 0.5, 0, 1])
  const patchStart = used[2]
  expect(used[patchStart]).toBe(1)
  expect(used[patchStart + 1]).toBe(12) // the green word
})

test('<Atlas> writes one node with a placement per sprite', () => {
  const { used } = compile([
    node(NodeType.Atlas, {
      image: handle(7),
      sprites: [
        { rect: { x: 0, y: 0, width: 10, height: 20 }, x: 100, y: 50 },
        { rect: { x: 10, y: 0, width: 10, height: 20 }, x: 0, y: 0, scale: 2 },
      ],
    }),
  ])
  // header(3) rootCount kind handle sampling bufferId count
  expect(used[4]).toBe(Kind.Atlas)
  expect(used[5]).toBe(7)
  expect(used[6]).toBe(1)
  expect(used[7]).toBe(0) // inline, no shared buffer
  expect(used[8]).toBe(2)

  // The source rect, the scale, then the sprite's centre (native applies the bias).
  expect(Array.from(used.subarray(9, 16))).toEqual([0, 0, 10, 20, 1, 100, 50])
  expect(Array.from(used.subarray(16, 23))).toEqual([10, 0, 10, 20, 2, 0, 0])
})

test('<Atlas> with no sprites still encodes a well-formed node', () => {
  const { used } = compile([node(NodeType.Atlas, { image: handle(3) })])
  expect(used[4]).toBe(Kind.Atlas)
  expect(used[8]).toBe(0)
})

test('<Atlas> encodes a hole in the sprite array rather than throwing', () => {
  const { used } = compile([
    node(NodeType.Atlas, {
      image: handle(3),
      sprites: [undefined, { x: 5, y: 5 }],
    }),
  ])
  expect(used[8]).toBe(2)
  expect(Array.from(used.subarray(9, 23))).toEqual([
    0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 5, 5,
  ])
})

test('<Vertices> writes positions, then the optional blocks in order', () => {
  const { used } = compile([
    node(NodeType.Vertices, {
      vertices: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
      ],
      colors: ['#ff0000', '#00ff00', '#0000ff'],
      indices: [0, 1, 2],
      mode: 'triangleStrip',
    }),
  ])
  // kind, bufferId, topology, count, then two words per vertex
  expect(used[4]).toBe(Kind.Vertices)
  expect(used[5]).toBe(0) // inline, no shared buffer
  expect(used[6]).toBe(1)
  expect(used[7]).toBe(3)
  expect(Array.from(used.subarray(8, 14))).toEqual([0, 0, 10, 0, 0, 10])
  expect(used[14]).toBe(0) // no texture coordinates
  expect(used[15]).toBe(1) // colours follow
  expect(Array.from(used.subarray(16, 19))).toEqual([
    0xffff0000, 0xff00ff00, 0xff0000ff,
  ])
  expect(used[19]).toBe(3)
  expect(Array.from(used.subarray(20, 23))).toEqual([0, 1, 2])
})

test('<Vertices> drops an attribute array shorter than the vertices', () => {
  const { used } = compile([
    node(NodeType.Vertices, {
      vertices: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      colors: ['#ff0000'],
      textures: [{ x: 1, y: 1 }],
    }),
  ])
  expect(used[7]).toBe(2)
  expect(used[12]).toBe(0) // textures dropped
  expect(used[13]).toBe(0) // colours dropped
  expect(used[14]).toBe(0) // no indices
})

test('<Vertices> with nothing at all still encodes a well-formed node', () => {
  const { used } = compile([node(NodeType.Vertices, {})])
  expect(used[4]).toBe(Kind.Vertices)
  expect(used[7]).toBe(0)
})

test('<Vertices> writes an out-of-range index through for native to reject', () => {
  const { used } = compile([
    node(NodeType.Vertices, {
      vertices: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ],
      indices: [0, 1, 9, -1, 2.5],
    }),
  ])
  expect(used[16]).toBe(5)
  // Truncated, never rounded: the reader range-checks and drops the whole mesh.
  expect(Array.from(used.subarray(17, 22))).toEqual([0, 1, 9, -1, 2])
})

test('<Group picture> sets the record flag on a static subtree', () => {
  const { used } = compile([
    node(NodeType.Group, { picture: true }, [
      node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }),
    ]),
  ])
  expect(used[4]).toBe(Kind.GroupLayer)
  expect(used[5]).toBe(0) // no transform ops
  expect(used[6]).toBe(8) // picture, no clip and no layer
})

// Intent, not a verdict: the writer dedupes slots, so only the reader can tell.
test('<Group picture> still asks to record when a child animates', () => {
  const { used } = compile([
    node(NodeType.Group, { picture: true }, [
      node(NodeType.Rect, {
        x: sharedValue(3),
        y: 0,
        width: 1,
        height: 1,
      }),
    ]),
  ])
  expect(used[4]).toBe(Kind.GroupLayer)
  expect(used[6]).toBe(8)
})

test('<Group picture> keeps the clip and layer bits alongside it', () => {
  const { used } = compile([
    node(
      NodeType.Group,
      { picture: true, layer: true, clip: { x: 0, y: 0, width: 4, height: 4 } },
      [node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 })]
    ),
  ])
  expect(used[6]).toBe(1 | 4 | 8)
})

test('a handled node records where it sits in the drawn tree', () => {
  const outer = createHandle()
  const inner = createHandle()
  const writer = new SceneWriter()
  compileScene(
    [
      node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }),
      node(NodeType.Group, {}, [
        node(NodeType.Circle, { cx: 0, cy: 0, r: 1, ref: inner }),
      ]),
      node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1, ref: outer }),
    ],
    writer
  )
  expect(writer.refPaths.map((entry) => entry.path)).toEqual([[1, 0], [2]])
})

// Both lists restart at 0 natively, so a shared path would name the matte instead.
test('a handle in a mask source cannot collide with one in its content', () => {
  const inSource = createHandle()
  const inContent = createHandle()
  const writer = new SceneWriter()
  compileScene(
    [
      node(NodeType.Mask, {}, [
        node(NodeType.MaskSource, {}, [
          node(NodeType.Circle, { cx: 0, cy: 0, r: 1, ref: inSource }),
        ]),
        node(NodeType.Rect, {
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          ref: inContent,
        }),
      ]),
    ],
    writer
  )
  const paths = writer.refPaths.map((entry) => entry.path.join(','))
  expect(new Set(paths).size).toBe(2)
  expect(paths).toContain('0,0')
  expect(paths).toContain('0,-1,0')
})

// ---- v26: imperative slot coverage (#204) ----

const sharedString = (value: string) => ({
  value,
  _isReanimatedSharedValue: true as const,
})

test('visible rides the kind word: absent costs nothing, present adds one anim word', () => {
  const plain = compile([
    node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }),
  ])
  expect(plain.used[4]).toBe(Kind.Rect)

  const hidden = compile([
    node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1, visible: false }),
  ])
  expect(hidden.used[4]).toBe(Kind.Rect | 64)
  expect(hidden.used[5]).toBe(0)
  expect(hidden.used.length).toBe(plain.used.length + 1)

  const live = sharedValue(1)
  const toggled = compile([
    node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1, visible: live }),
  ])
  expect(toggled.used[4]).toBe(Kind.Rect | 64)
  expect(toggled.values).toEqual([live])
})

test('a group and a mask carry visible the same way', () => {
  const { used } = compile([
    node(NodeType.Group, { visible: false }, [
      node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }),
    ]),
  ])
  expect(used[4]).toBe(Kind.Group | 64)
  expect(used[5]).toBe(0)
})

test('gradient endpoints, stops and positions take value slots', () => {
  const endX = sharedValue(20)
  const pos = sharedValue(0.5)
  const { used, values } = compile([
    {
      ...node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }),
      children: [
        node(NodeType.LinearGradient, {
          start: { x: 0, y: 0 },
          end: { x: endX, y: 10 },
          colors: ['#ff0000', '#0000ff'],
          positions: [0, pos],
        }),
      ],
    },
  ])
  expect(values).toEqual([endX, pos])
  // Shader kind sits after the 7-word paint block; geometry follows it.
  expect(used[15]).toBe(0) // linear
  expect(used[18]).toBe(20) // the animated end.x literal
  // stops flags word says the colours are packed (no live channel).
  expect(used[20]).toBe(0)
})

test('a live stop colour switches the stops block to four channels per stop', () => {
  const r = sharedValue(1)
  const { used, values } = compile([
    {
      ...node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }),
      children: [
        node(NodeType.LinearGradient, {
          start: { x: 0, y: 0 },
          end: { x: 10, y: 0 },
          colors: [[r, 0, 0, 1], '#0000ff'],
        }),
      ],
    },
  ])
  expect(values).toEqual([r])
  // flags word 1: both stops travel as channels, 4 words each.
  expect(used[20]).toBe(1)
  expect(used[21]).toBe(2) // stop count
})

test('blur and drop-shadow parameters take value slots', () => {
  const radius = sharedValue(4)
  const blurred = compile([
    {
      ...node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }),
      children: [node(NodeType.Blur, { blur: radius })],
    },
  ])
  expect(blurred.values).toEqual([radius])

  const dx = sharedValue(2)
  const shadowed = compile([
    {
      ...node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }),
      children: [node(NodeType.DropShadow, { dx, dy: 2, blur: 3 })],
    },
  ])
  expect(shadowed.values).toEqual([dx])
})

test('a live shadow colour writes the channel block behind flag bit 4', () => {
  const g = sharedValue(0.5)
  const { used, values } = compile([
    {
      ...node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }),
      children: [
        node(NodeType.DropShadow, {
          dx: 1,
          dy: 2,
          blur: 3,
          color: [0, g, 0, 1],
        }),
      ],
    },
  ])
  expect(values).toEqual([g])
  // flags word gains bit 4 and four channel words follow it.
  let shadowAt = -1
  for (let i = 0; i < used.length - 3; i++) {
    if (
      used[i] === 1 &&
      used[i + 1] === 2 &&
      used[i + 2] === 3 &&
      used[i + 3] === 3
    ) {
      shadowAt = i
      break
    }
  }
  expect(shadowAt).toBeGreaterThan(0)
  expect(used[shadowAt + 5]).toBe(4)
  expect(Array.from(used.subarray(shadowAt + 6, shadowAt + 10))).toEqual([
    0, 0.5, 0, 1,
  ])
})

test('a colour-matrix entry takes a value slot', () => {
  const gain = sharedValue(1)
  const matrix = [gain, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]
  const { values } = compile([
    {
      ...node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }),
      children: [node(NodeType.ColorMatrix, { matrix })],
    },
  ])
  expect(values).toEqual([gain])
})

test('an image source rect takes value slots', () => {
  const frame = sharedValue(0)
  const { values } = compile([
    node(NodeType.Image, {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      image: handle(9),
      rect: { x: frame, y: 0, width: 32, height: 32 },
    }),
  ])
  expect(values).toEqual([frame])
})

test('a shared image handle becomes a value slot', () => {
  const which = sharedValue(9)
  const { used, values } = compile([
    node(NodeType.Image, {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      image: which,
    }),
  ])
  expect(values).toEqual([which])
  expect(used[9]).toBe(9) // the handle word carries the current literal
})

test('a SharedValue path takes a string slot and patches the string table word', () => {
  const path = sharedString('M0 0 L1 1')
  const { used, strings, stringValues } = compile([
    node(NodeType.Path, { path }),
  ])
  expect(strings).toEqual(['M0 0 L1 1'])
  expect(stringValues).toEqual([path])
  // The string patch table follows the numeric one: count, wordIndex, slot.
  const patchStart = used[2]!
  const numeric = used[patchStart]!
  const stringsAt = patchStart + 1 + numeric * 2
  expect(used[stringsAt]).toBe(1)
  expect(used[stringsAt + 1]).toBe(5) // the path word
  expect(used[stringsAt + 2]).toBe(0) // string slot 0
})

test('a SharedValue text takes a string slot per run', () => {
  const text = sharedString('42')
  const { stringValues, used } = compile([
    node(NodeType.Text, { x: 0, y: 0, text }),
  ])
  expect(stringValues).toEqual([text])
  const patchStart = used[2]!
  const stringsAt = patchStart + 1 + used[patchStart]! * 2
  expect(used[stringsAt]).toBe(1)
})

test('a static scene writes an empty string patch table', () => {
  const { used, stringValues } = compile([
    node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }),
  ])
  expect(stringValues).toEqual([])
  expect(used[used.length - 1]).toBe(0)
})

test('<Atlas buffer> writes the buffer id and a live count instead of sprites', () => {
  const count = sharedValue(3)
  const { used, values } = compile([
    node(NodeType.Atlas, {
      image: handle(7),
      buffer: { id: 5, capacity: 8 },
      count,
    }),
  ])
  expect(used[7]).toBe(5)
  expect(used[8]).toBe(3)
  expect(values).toEqual([count])
})

test('<Atlas buffer> with id 0 falls back to the inline sprites', () => {
  const { used } = compile([
    node(NodeType.Atlas, {
      image: handle(7),
      buffer: { id: 0, capacity: 8 },
      sprites: [{ rect: { x: 0, y: 0, width: 1, height: 1 }, x: 5, y: 5 }],
    }),
  ])
  expect(used[7]).toBe(0)
  expect(used[8]).toBe(1)
})

test('<Vertices buffer> writes capacities, flags and live counts', () => {
  const vertexCount = sharedValue(3)
  const { used, values } = compile([
    node(NodeType.Vertices, {
      buffer: {
        id: 4,
        maxVertices: 16,
        maxIndices: 24,
        hasTextures: true,
        hasColors: false,
      },
      vertexCount,
      mode: 'triangleStrip',
    }),
  ])
  expect(Array.from(used.subarray(5, 10))).toEqual([4, 1, 16, 24, 1])
  expect(used[10]).toBe(3)
  expect(used[11]).toBe(24)
  expect(values).toEqual([vertexCount])
})

test('animated sprite fields take value slots', () => {
  const x = sharedValue(50)
  const { values } = compile([
    node(NodeType.Atlas, {
      image: handle(7),
      sprites: [{ rect: { x: 0, y: 0, width: 10, height: 10 }, x, y: 0 }],
    }),
  ])
  expect(values).toEqual([x])
})

test('a handle write makes text live from the first write', () => {
  const ref = createHandle()
  const handleInternals = (
    require('../imperative') as typeof import('../imperative')
  ).nodeInternals(ref)
  ref.set({ text: '42' })
  const writer = new SceneWriter()
  const first = compileScene(
    [node(NodeType.Text, { x: 0, y: 0, text: 'start', ref })],
    writer
  )
  expect(first.stringValues.length).toBe(1)
  expect(first.strings).toContain('42')
  handleInternals.bind({ pushValues: () => {}, recompile: () => {} }, writer)
})

test('a handle write makes an enum live from the first write', () => {
  const ref = createHandle()
  ref.set({ strokeCap: 'round' })
  const writer = new SceneWriter()
  const result = compileScene(
    [
      node(NodeType.Rect, {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        style: 'stroke',
        ref,
      }),
    ],
    writer
  )
  // Geometry substitution adds x/y/w/h; the cap slot rides along with code 1.
  expect(result.values.length).toBe(5)
  expect(Number((result.values[4] as { value: unknown }).value)).toBe(1)
})

test('a handle on a gradient patches its geometry after the first write', () => {
  const ref = createHandle()
  ref.set({ end: { x: 30, y: 0 } })
  const writer = new SceneWriter()
  const result = compileScene(
    [
      {
        ...node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }),
        children: [
          node(NodeType.LinearGradient, {
            start: { x: 0, y: 0 },
            end: { x: 10, y: 0 },
            colors: ['#ff0000', '#0000ff'],
            ref,
          }),
        ],
      },
    ],
    writer
  )
  expect(result.values.length).toBe(2) // endX and endY slots
})

test('a handle image write swaps the handle word to a slot', () => {
  const ref = createHandle()
  ref.set({ image: 42 })
  const writer = new SceneWriter()
  const result = compileScene(
    [
      node(NodeType.Image, {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        image: handle(9),
        ref,
      }),
    ],
    writer
  )
  expect(result.values.length).toBe(5)
  expect(Number((result.values[4] as { value: unknown }).value)).toBe(42)
})

test('a Blend handle mode write resolves to its code, not srcOver', () => {
  const ref = createHandle()
  ref.set({ mode: 'multiply' })
  const writer = new SceneWriter()
  const { buffer } = compileScene(
    [
      {
        ...node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }),
        children: [
          {
            ...node(NodeType.Blend, { mode: 'screen', ref }),
            children: [
              node(NodeType.ColorShader, { color: '#ff0000' }),
              node(NodeType.ColorShader, { color: '#00ff00' }),
            ],
          },
        ],
      },
    ],
    writer
  )
  const words = new Float64Array(buffer)
  // Shader kind 8, then the fold's mode word: multiply is 24 in BLEND_MODES.
  const at = words.indexOf(8, 15)
  expect(words[at + 1]).toBe(24)
})

test('changing the stop count through a handle re-encodes instead of dropping stops', () => {
  const ref = createHandle()
  const writer = new SceneWriter()
  const gradient = () => ({
    ...node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }),
    children: [
      node(NodeType.LinearGradient, {
        start: { x: 0, y: 0 },
        end: { x: 10, y: 0 },
        colors: ['#ff0000', '#0000ff'],
        ref,
      }),
    ],
  })
  const handleInternals = (
    require('../imperative') as typeof import('../imperative')
  ).nodeInternals(ref)
  let recompiled = 0
  const owner = {
    pushValues: () => {},
    recompile: () => {
      recompiled++
      // The container's recompile: re-encode with the overrides and re-bind.
      handleInternals.bind(owner, compileAgain())
    },
  }
  const compileAgain = () => {
    compileScene([gradient()], writer, false)
    return writer
  }
  compileScene([gradient()], writer)
  handleInternals.bind(owner, writer)
  // First write goes live-from-first-write: one re-encode hands out the slots.
  ref.set({ colors: ['#00ff00', '#ff00ff'] })
  expect(recompiled).toBe(1)
  // Same count again: a plain patch, no further re-encode.
  ref.set({ colors: ['#ffff00', '#00ffff'] })
  expect(recompiled).toBe(1)
  // Three stops now: the program only compiled two, so this must re-encode.
  ref.set({ colors: ['#00ff00', '#ff00ff', '#123456'] })
  expect(recompiled).toBe(2)
})

test('colors written to a non-gradient handle fall through to a re-encode', () => {
  const ref = createHandle()
  const writer = new SceneWriter()
  compileScene(
    [
      node(NodeType.Vertices, {
        vertices: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0, y: 1 },
        ],
        colors: ['#ff0000', '#00ff00', '#0000ff'],
        ref,
      }),
    ],
    writer
  )
  let recompiled = 0
  const handleInternals = (
    require('../imperative') as typeof import('../imperative')
  ).nodeInternals(ref)
  handleInternals.bind(
    { pushValues: () => {}, recompile: () => recompiled++ },
    writer
  )
  // Not gradient stops: the write must go the generic override + re-encode way.
  ref.set({ colors: ['#111111', '#222222', '#333333'] })
  expect(recompiled).toBe(1)
})

// The scope of the ordering rule, pinned so it cannot drift silently: a <Paint>
// child and an inherited group paint are merged, not chained.
test('a colour filter from a <Paint> or a group stays on the paint', () => {
  const viaPaint = compile([
    node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }, [
      node(NodeType.Blur, { blur: 2 }),
      node(NodeType.Paint, {}, [node(NodeType.Luma, {})]),
    ]),
  ])
  // Same words as <Luma/><Blur/>: the luma is on the paint and runs first.
  expect(Array.from(viaPaint.used.subarray(15, 21))).toEqual([3, 2, 0, 2, 2, 3])

  const inherited = compile([
    node(NodeType.Group, {}, [
      node(NodeType.Paint, {}, [node(NodeType.Blur, { blur: 2 })]),
      node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }, [
        node(NodeType.Luma, {}),
      ]),
    ]),
  ])
  // group(kind, opCount, childCount) then the rect: kind x y w h + 6 paint
  // words, so the child's filter block starts at 18.
  expect(inherited.used[7]).toBe(Kind.Rect)
  expect(Array.from(inherited.used.subarray(18, 24))).toEqual([
    3, 2, 0, 2, 2, 3,
  ])
})
