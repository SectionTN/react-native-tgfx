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
  expect(used.length).toBe(3 + 1 + 5 + 7 + 1)
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
  expect(Array.from(rect.used.subarray(4, 12))).toEqual([13, 0, 1, 1, 1, 2, 3, 4])

  const rounded = compile([
    node(NodeType.Group, { clip: { x: 1, y: 2, width: 3, height: 4, r: 5 } }, []),
  ])
  expect(Array.from(rounded.used.subarray(6, 14))).toEqual([1, 2, 1, 2, 3, 4, 5, 5])

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
  expect(layered.used[layered.used.length - 3]).toBe(1)

  const flattened = compile([
    node(NodeType.Group, { opacity: 0.5 }, [
      node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }),
    ]),
  ])
  expect(flattened.used[flattened.used.length - 3]).toBe(0.5)
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
  expect(used.length).toBe(3 + 1 + 3 + IMAGE_WORDS + 1)
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
  60,
  57,
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
  2,
  4294967295,
  4278190080,
  0,
  1,
  10,
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
  expect(used.length).toBe(3 + 1 + 1 + 7 + 1)
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
  expect(used.length).toBe(3 + 1 + 5 + 7 + 1)
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
  expect(used.length).toBe(3 + 1 + 5 + 7 + 1)
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

test('two filters of the same class on one paint warn in development', () => {
  ;(globalThis as { __DEV__?: boolean }).__DEV__ = true
  const warn = console.warn
  const messages: string[] = []
  console.warn = (message: string) => messages.push(message)
  try {
    compile([
      node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }, [
        node(NodeType.Blur, { blur: 2 }),
        node(NodeType.Blur, { blur: 7 }),
      ]),
    ])
    compile([
      node(NodeType.Rect, { x: 0, y: 0, width: 1, height: 1 }, [
        node(NodeType.Blur, { blur: 2 }),
        node(NodeType.ColorMatrix, { matrix: new Array(20).fill(0) }),
      ]),
    ])
  } finally {
    console.warn = warn
  }
  expect(messages.length).toBe(1)
  expect(messages[0]).toContain('two image filters')
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
  expect(used.length).toBe(3 + 1 + 5 + 7 + 1)
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
