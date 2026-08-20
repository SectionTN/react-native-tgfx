import { expect, mock, test } from 'bun:test'

// createHandle reaches for runOnJS; this file has no other reanimated dependency.
mock.module('react-native-reanimated', () => ({}))
import React, { type ReactNode } from 'react'
import { compileScene } from './compiler/compile'
import { SceneWriter } from './compiler/writer'
import { directNodes } from './reconciler/directNodes'
import { TgfxRoot } from './reconciler/Reconciler'
import type { Node } from './reconciler/types'
import { Group } from './components/Group'
import { Mask } from './components/Mask'
import {
  Atlas,
  BackdropBlur,
  CameraFrame,
  Circle,
  Fill,
  Glass,
  Glyphs,
  TgfxImage,
  ImageSVG,
  Line,
  Oval,
  Path,
  Rect,
  RoundedRect,
  Span,
  Text,
  TextPath,
  Vertices,
} from './components/drawings'
import {
  AlphaThreshold,
  Blend,
  BlendColor,
  Blur,
  ColorMatrix,
  ColorShader,
  CornerPathEffect,
  DashPathEffect,
  DiamondGradient,
  DropShadow,
  FilmGrain,
  FractalNoise,
  ImageShader,
  LinearGradient,
  Luma,
  Paint,
  RadialGradient,
  Shader,
  SweepGradient,
  Turbulence,
} from './components/Paint'
import * as e from './elements'
import { createHandle } from './imperative'

const img = { handle: 7, width: 32, height: 16 }

function compiled(roots: Node[]) {
  const writer = new SceneWriter()
  const { buffer, strings } = compileScene(roots, writer)
  const words = new Float64Array(buffer)
  return { words: Array.from(words.subarray(0, words[1])), strings }
}

function expectParity(jsx: ReactNode, nodes: Node[]) {
  const direct = directNodes(jsx)
  expect(direct).not.toBeNull()
  const fromJsx = compiled(direct!)
  const fromFactories = compiled(nodes)
  expect(fromFactories.words).toEqual(fromJsx.words)
  expect(fromFactories.strings).toEqual(fromJsx.strings)
}

const SKSL = `
uniform float uLevel;
half4 main(float2 p) {
  return half4(uLevel, 0.0, 0.0, 1.0);
}
`

test('every shape factory compiles byte-identically to its JSX component', () => {
  const rect = { x: 1, y: 2, width: 3, height: 4, color: '#e33' } as const
  const rrect = { x: 1, y: 1, width: 8, height: 6, r: 2 } as const
  const oval = { x: 0, y: 0, width: 6, height: 3, color: 'gold' } as const
  const circle = { cx: 5, cy: 5, r: 4, style: 'stroke' } as const
  const line = { x1: 0, y1: 0, x2: 9, y2: 9, strokeWidth: 2 } as const
  const path = { path: 'M0 0L10 10', color: '#06c' } as const
  expectParity(
    <>
      <Rect {...rect} />
      <RoundedRect {...rrect} />
      <Oval {...oval} />
      <Circle {...(circle as object)} />
      <Line {...line} />
      <Path {...path} />
    </>,
    [
      e.rect(rect),
      e.rrect(rrect),
      e.oval(oval),
      e.circle(circle as never),
      e.line(line),
      e.path(path),
    ]
  )
})

test('group, fill, image and imageSvg match', () => {
  const group = {
    transform: [{ translate: [4, 4] as [number, number] }, { rotate: 0.3 }],
    opacity: 0.5,
    clip: { x: 0, y: 0, width: 10, height: 10 },
  }
  const image = { image: img, x: 0, y: 0, width: 8, height: 8, fit: 'cover' }
  expectParity(
    <>
      <Group {...(group as object)}>
        <Rect x={0} y={0} width={2} height={2} />
      </Group>
      <Fill color="#123456" />
      <TgfxImage {...(image as object)} />
      <ImageSVG {...(image as object)} />
    </>,
    [
      e.group(group as never, [e.rect({ x: 0, y: 0, width: 2, height: 2 })]),
      e.fill({ color: '#123456' }),
      e.image(image as never),
      e.imageSvg(image as never),
    ]
  )
})

test('text, spans, glyphs and textPath match', () => {
  const text = { x: 4, y: 20, text: 'hello', fontSize: 14 }
  const spanA = { text: 'a: ' }
  const spanB = { text: 'b', fontWeight: 'bold', color: '#0a7' }
  const glyphs = {
    x: 5,
    y: 6,
    fontSize: 18,
    fontFamily: 'PT Serif',
    glyphs: [
      { id: 40, x: 0, y: 0 },
      { id: 72, x: 11.5, y: -3 },
    ],
  }
  const onPath = {
    path: 'M0 0 L10 0',
    text: 'hi',
    fontSize: 12,
    startOffset: 4,
  }
  expectParity(
    <>
      <Text {...text} />
      <Text x={0} y={0} fontSize={12}>
        <Span {...spanA} />
        <Span {...(spanB as object)} />
      </Text>
      <Glyphs {...(glyphs as object)} />
      <TextPath {...onPath} />
    </>,
    [
      e.text(text),
      e.text({ x: 0, y: 0, fontSize: 12 }, [
        e.span(spanA),
        e.span(spanB as never),
      ]),
      e.glyphs(glyphs as never),
      e.textPath(onPath),
    ]
  )
})

test('atlas, vertices, backdrop, glass and cameraFrame match', () => {
  const atlas = {
    image: img,
    sprites: [
      { rect: { x: 0, y: 0, width: 10, height: 20 }, x: 100, y: 50 },
      { rect: { x: 10, y: 0, width: 10, height: 20 }, x: 0, y: 0, scale: 2 },
    ],
  }
  const vertices = {
    vertices: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ],
    colors: ['#ff0000', '#00ff00', '#0000ff'],
    indices: [0, 1, 2],
    mode: 'triangleStrip',
  }
  const backdrop = { x: 0, y: 0, width: 12, height: 6, blur: 4, r: 2 }
  const glass = { x: 1, y: 1, width: 10, height: 5, r: 2, refraction: 12 }
  expectParity(
    <>
      <Atlas {...(atlas as object)} />
      <Vertices {...(vertices as object)} />
      <BackdropBlur {...(backdrop as object)} />
      <Glass {...(glass as object)} />
      <CameraFrame image={img as never}>
        <Rect x={0} y={0} width={1} height={1} />
      </CameraFrame>
    </>,
    [
      e.atlas(atlas as never),
      e.vertices(vertices as never),
      e.backdropBlur(backdrop as never),
      e.glass(glass as never),
      e.cameraFrame({ image: img as never }, [
        e.rect({ x: 0, y: 0, width: 1, height: 1 }),
      ]),
    ]
  )
})

test('paint, gradients, shaders and noise match', () => {
  const linear = {
    start: { x: 0, y: 0 },
    end: { x: 8, y: 8 },
    colors: ['#000', '#fff'],
  }
  const radial = { center: { x: 4, y: 4 }, radius: 4, colors: ['#f00', '#00f'] }
  const sweep = { center: { x: 4, y: 4 }, colors: ['#f00', '#00f'] }
  const uniforms = { uLevel: 0.25 }
  expectParity(
    <>
      <Rect x={0} y={0} width={8} height={8}>
        <LinearGradient {...(linear as object)} />
      </Rect>
      <Rect x={0} y={0} width={8} height={8}>
        <RadialGradient {...(radial as object)} />
      </Rect>
      <Rect x={0} y={0} width={8} height={8}>
        <SweepGradient {...(sweep as object)} />
      </Rect>
      <Rect x={0} y={0} width={8} height={8}>
        <DiamondGradient {...(radial as object)} />
      </Rect>
      <Rect x={0} y={0} width={8} height={8}>
        <Paint color="#333" style="stroke" strokeWidth={2} />
      </Rect>
      <Rect x={0} y={0} width={8} height={8}>
        <Shader source={SKSL} uniforms={uniforms} />
      </Rect>
      <Rect x={0} y={0} width={8} height={8}>
        <ImageShader image={img as never} tileModeX="repeat" />
      </Rect>
      <Fill>
        <Blend mode="multiply">
          <ColorShader color="#ff0044" />
          <FractalNoise freqX={0.02} freqY={0.02} octaves={3} />
        </Blend>
      </Fill>
      <Fill opacity={0.2}>
        <Turbulence freqX={0.05} freqY={0.05} octaves={2} />
      </Fill>
    </>,
    [
      e.rect({ x: 0, y: 0, width: 8, height: 8 }, [
        e.linearGradient(linear as never),
      ]),
      e.rect({ x: 0, y: 0, width: 8, height: 8 }, [
        e.radialGradient(radial as never),
      ]),
      e.rect({ x: 0, y: 0, width: 8, height: 8 }, [
        e.sweepGradient(sweep as never),
      ]),
      e.rect({ x: 0, y: 0, width: 8, height: 8 }, [
        e.diamondGradient(radial as never),
      ]),
      e.rect({ x: 0, y: 0, width: 8, height: 8 }, [
        e.paint({ color: '#333', style: 'stroke', strokeWidth: 2 }),
      ]),
      e.rect({ x: 0, y: 0, width: 8, height: 8 }, [
        e.shader({ source: SKSL, uniforms }),
      ]),
      e.rect({ x: 0, y: 0, width: 8, height: 8 }, [
        e.imageShader({ image: img as never, tileModeX: 'repeat' }),
      ]),
      e.fill(undefined, [
        e.blend({ mode: 'multiply' }, [
          e.colorShader({ color: '#ff0044' }),
          e.fractalNoise({ freqX: 0.02, freqY: 0.02, octaves: 3 }),
        ]),
      ]),
      e.fill({ opacity: 0.2 }, [
        e.turbulence({ freqX: 0.05, freqY: 0.05, octaves: 2 }),
      ]),
    ]
  )
})

test('filters, effects and film grain match', () => {
  const shadow = { dx: 0, dy: 4, blur: 12, color: '#0008' }
  const matrix = [
    0.39, 0.77, 0.19, 0, 0, 0.35, 0.69, 0.17, 0, 0, 0.27, 0.53, 0.13, 0, 0, 0,
    0, 0, 1, 0,
  ]
  expectParity(
    <>
      <TgfxImage image={img as never} x={0} y={0} width={8} height={8}>
        <Blur blur={4} />
        <Luma />
        <DropShadow {...(shadow as object)} />
      </TgfxImage>
      <TgfxImage image={img as never} x={0} y={0} width={8} height={8}>
        <ColorMatrix matrix={matrix} />
        <AlphaThreshold threshold={0.5} />
        <BlendColor color="#00f4" mode="overlay" />
      </TgfxImage>
      <Path path="M0 0L10 0L5 8Z" color="#e33">
        <DashPathEffect intervals={[8, 4]} />
      </Path>
      <Path path="M0 0L10 0L5 8Z" color="#e33">
        <CornerPathEffect r={6} />
      </Path>
      <Group>
        <FilmGrain size={1.2} density={0.4} />
        <Rect x={0} y={0} width={4} height={4} />
      </Group>
    </>,
    [
      e.image({ image: img as never, x: 0, y: 0, width: 8, height: 8 }, [
        e.blur({ blur: 4 }),
        e.luma(),
        e.dropShadow(shadow as never),
      ]),
      e.image({ image: img as never, x: 0, y: 0, width: 8, height: 8 }, [
        e.colorMatrix({ matrix }),
        e.alphaThreshold({ threshold: 0.5 }),
        e.blendColor({ color: '#00f4', mode: 'overlay' }),
      ]),
      e.path({ path: 'M0 0L10 0L5 8Z', color: '#e33' }, [
        e.dashPathEffect({ intervals: [8, 4] }),
      ]),
      e.path({ path: 'M0 0L10 0L5 8Z', color: '#e33' }, [
        e.cornerPathEffect({ r: 6 }),
      ]),
      e.group(undefined, [
        e.filmGrain({ size: 1.2, density: 0.4 }),
        e.rect({ x: 0, y: 0, width: 4, height: 4 }),
      ]),
    ]
  )
})

// JSX <Mask> is a function component, so it goes through the reconciler.
test('mask() builds the same MaskSource wrapper the component renders', () => {
  const root = new TgfxRoot(() => {})
  root.container.muted = true
  root.renderSync(
    <Mask mode="luminance" mask={<Rect x={0} y={0} width={8} height={8} />}>
      <Circle cx={4} cy={4} r={4} color="#0a7" />
    </Mask>
  )
  root.container.muted = false
  const fromJsx = compiled(root.container.root)
  root.container.muted = true
  root.unmount()
  const fromFactory = compiled([
    e.mask(
      { mode: 'luminance', mask: e.rect({ x: 0, y: 0, width: 8, height: 8 }) },
      [e.circle({ cx: 4, cy: 4, r: 4, color: '#0a7' })]
    ),
  ])
  expect(fromFactory.words).toEqual(fromJsx.words)
  expect(fromFactory.strings).toEqual(fromJsx.strings)
})

test('a ref on a factory node binds exactly as a JSX ref does', () => {
  const jsxHandle = createHandle()
  const factoryHandle = createHandle()
  const direct = directNodes(
    <Rect ref={jsxHandle} x={1} y={2} width={3} height={4} />
  )
  const fromJsx = compileScene(direct!, new SceneWriter())
  const fromFactory = compileScene(
    [e.rect({ ref: factoryHandle, x: 1, y: 2, width: 3, height: 4 })],
    new SceneWriter()
  )
  expect(fromFactory.refs.length).toBe(fromJsx.refs.length)
  expect(fromFactory.refs[0]).toBe(factoryHandle)
  expect(fromFactory.refPaths.map((r) => r.path)).toEqual(
    fromJsx.refPaths.map((r) => r.path)
  )
  const jsxWords = new Float64Array(fromJsx.buffer)
  const factoryWords = new Float64Array(fromFactory.buffer)
  expect(Array.from(factoryWords.subarray(0, factoryWords[1]))).toEqual(
    Array.from(jsxWords.subarray(0, jsxWords[1]))
  )
})

test('a string where props belong throws in dev, naming textToPath', () => {
  ;(globalThis as { __DEV__?: boolean }).__DEV__ = true
  try {
    expect(() =>
      (e.textPath as unknown as (s: string) => unknown)('outlined')
    ).toThrow(/textToPath/)
    expect(() => (e.text as unknown as (s: string) => unknown)('hi')).toThrow(
      /props object/
    )
  } finally {
    delete (globalThis as { __DEV__?: boolean }).__DEV__
  }
})
