import { expect, mock, test } from 'bun:test'

// compile reaches for runOnJS through createHandle; nothing else here needs reanimated.
mock.module('react-native-reanimated', () => ({}))
import { NodeType, type Node } from '../reconciler/types'
import { compileScene } from '../compiler/compile'
import { SceneWriter } from '../compiler/writer'
import {
  BackdropBlur,
  Glass,
  TgfxImage,
  ImageSVG,
} from '../components/drawings'

const panel = { x: 0, y: 0, width: 10, height: 10 }

const compile = (type: unknown, props: object) => {
  const writer = new SceneWriter()
  const node = { type, props, children: [] } as unknown as Node
  const result = compileScene([node], writer)
  return new Float64Array(result.buffer)
}

// x y w h r blur refraction: the seventh word after the kind is what picks glass over blur.
const refractionOf = (words: Float64Array) => words[3 + 1 + 1 + 4 + 1 + 1]

/// One wire kind carries both panels and a zero refraction is what makes it a plain blur, so
/// <Glass> has to supply the default its props document rather than silently drawing a blur.
test('Glass defaults refraction to 40, BackdropBlur leaves it a plain blur', () => {
  expect(refractionOf(compile(NodeType.Glass, { ...panel, frost: 30 }))).toBe(
    40
  )
  expect(
    refractionOf(compile(NodeType.Glass, { ...panel, refraction: 10 }))
  ).toBe(10)
  expect(refractionOf(compile(NodeType.Backdrop, { ...panel, blur: 8 }))).toBe(
    0
  )
})

// splay, light angle, light intensity: the three anim words after dispersion.
const lightOf = (words: Float64Array) =>
  Array.from(
    words.subarray(
      3 + 1 + 1 + 4 + 1 + 1 + 3 + 1,
      3 + 1 + 1 + 4 + 1 + 1 + 3 + 1 + 3
    )
  )

/// These carry tgfx's own defaults rather than zeros, so a <Glass> that names none of them
/// draws exactly as it did before they were writable — and a named one has to reach the wire.
test('Glass writes its light words, defaulted to what the reader used to hardcode', () => {
  expect(lightOf(compile(NodeType.Glass, panel))).toEqual([0, 45, 50])
  expect(
    lightOf(
      compile(NodeType.Glass, {
        ...panel,
        splay: 100,
        lightAngle: -135,
        lightIntensity: 0,
      })
    )
  ).toEqual([100, -135, 0])
  // A plain blur ignores them, but the words are still there: one kind, one layout.
  expect(lightOf(compile(NodeType.Backdrop, { ...panel, blur: 8 }))).toEqual([
    0, 45, 50,
  ])
})

/// directNodes is all-or-nothing: one element whose type is not a host string drops the whole
/// canvas off the fast path, so neither of these may be a wrapper component.
// The whole reason ImageSVG is an alias and not a wrapper: a component would
// drop every scene using it off directNodes' fast path, and no pixel test can
// see that — both would draw the same frame.
test('ImageSVG is the TgfxImage host node, not a wrapper component', () => {
  expect(typeof ImageSVG).toBe('string')
  expect(ImageSVG).toBe(TgfxImage)
})

test('both panels stay host node types', () => {
  expect(typeof Glass).toBe('string')
  expect(typeof BackdropBlur).toBe('string')
  expect(Glass).toBe(NodeType.Glass as unknown as typeof Glass)
  expect(BackdropBlur).toBe(NodeType.Backdrop as unknown as typeof BackdropBlur)
})
