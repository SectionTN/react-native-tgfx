import { beforeEach, expect, mock, test } from 'bun:test'
import React from 'react'
import { nativeMocks } from '../testing/nativeMocks'

// createHandle reaches for runOnJS; nothing else here touches reanimated.
mock.module('react-native-reanimated', () => ({}))

let svgCalls: {
  words: Float64Array
  strings: string[]
  width: number
  height: number
  textAsPaths: boolean
}[] = []

let pdfCalls: {
  path: string
  pages: number
  strings: string[]
  stringCounts: number[]
  sizes: number[]
  metadata: string[]
}[] = []

let calls: {
  words: Float64Array
  strings: string[]
  width: number
  height: number
  pixelRatio: number
  opaque: boolean
}[] = []

// Set through the shared registry: a second mock.module would fight the first.
beforeEach(() => {
  calls = []
  pdfCalls = []
  svgCalls = []
  nativeMocks.hybridObject = () => ({
    toSvg: (
      words: ArrayBuffer,
      strings: string[],
      width: number,
      height: number,
      textAsPaths: boolean
    ) => {
      svgCalls.push({
        words: new Float64Array(words),
        strings,
        width,
        height,
        textAsPaths,
      })
      return Promise.resolve('<svg/>')
    },
    savePdf: (
      path: string,
      pages: ArrayBuffer[],
      strings: string[],
      stringCounts: number[],
      sizes: number[],
      metadata: string[]
    ) => {
      pdfCalls.push({
        path,
        pages: pages.length,
        strings,
        stringCounts,
        sizes,
        metadata,
      })
      return Promise.resolve()
    },
    fromScene: (
      words: ArrayBuffer,
      strings: string[],
      width: number,
      height: number,
      pixelRatio: number,
      opaque: boolean,
      colorSpace: string
    ) => {
      calls.push({
        words: new Float64Array(words),
        strings,
        width,
        height,
        pixelRatio,
        opaque,
        colorSpace,
      })
      return Promise.resolve({ handle: 1 })
    },
  })
})

const { renderToImage, renderToPdf, renderToSvg } = await import('../offscreen')
const { Rect, Path } = await import('../components/drawings')

test('renderToImage compiles the tree and hands over the options', async () => {
  await renderToImage(
    <Rect x={1} y={2} width={3} height={4} color="#ff0000" />,
    {
      width: 64,
      height: 32,
      pixelRatio: 2,
      opaque: true,
      colorSpace: 'display-p3',
    }
  )
  expect(calls.length).toBe(1)
  const call = calls[0]!
  expect(call.width).toBe(64)
  expect(call.height).toBe(32)
  expect(call.pixelRatio).toBe(2)
  expect(call.opaque).toBe(true)
  expect(call.colorSpace).toBe('display-p3')
  expect(call.words[3]).toBe(1) // one root node
})

test('renderToImage defaults pixelRatio, opaque and the colour space', async () => {
  await renderToImage(<Rect x={0} y={0} width={1} height={1} />, {
    width: 8,
    height: 8,
  })
  expect(calls[0]!.pixelRatio).toBe(1)
  expect(calls[0]!.opaque).toBe(false)
  // Not undefined: native reads anything but 'display-p3' as sRGB, but an
  // explicit default keeps the surface's space out of the bridge's hands.
  expect(calls[0]!.colorSpace).toBe('srgb')
})

// The delta form carries a count at index 0, which would shift every string index.
test('renderToImage sends the decoded string table, not the packed delta', async () => {
  await renderToImage(<Path path="M0 0 L10 0 Z" color="#00ff00" />, {
    width: 16,
    height: 16,
  })
  expect(calls[0]!.strings).toEqual(['M0 0 L10 0 Z'])
})

test('renderToImage expands function components', async () => {
  const Two = () => (
    <>
      <Rect x={0} y={0} width={1} height={1} />
      <Rect x={1} y={1} width={1} height={1} />
    </>
  )
  await renderToImage(<Two />, { width: 8, height: 8 })
  expect(calls[0]!.words[3]).toBe(2)
})

test('renderToImage rejects rather than resolving with a blank image', async () => {
  const Boom = (): React.ReactElement => {
    throw new Error('boom')
  }
  await expect(
    renderToImage(<Boom />, { width: 8, height: 8 })
  ).rejects.toThrow('compiled to nothing')
  expect(calls.length).toBe(0)
})

test('renderToImage leaves nothing mounted between calls', async () => {
  await renderToImage(<Rect x={0} y={0} width={1} height={1} />, {
    width: 8,
    height: 8,
  })
  await renderToImage(<Rect x={0} y={0} width={2} height={2} />, {
    width: 8,
    height: 8,
  })
  expect(calls.length).toBe(2)
  expect(calls[0]!.words[3]).toBe(1)
  expect(calls[1]!.words[3]).toBe(1)
})

test('renderToPdf compiles a program per page and keeps the string tables apart', async () => {
  await renderToPdf(
    '/tmp/out.pdf',
    [
      { width: 612, height: 792, element: <Path path="M0 0 L1 0 Z" /> },
      {
        width: 595,
        height: 842,
        element: <Rect x={0} y={0} width={1} height={1} />,
      },
    ],
    { title: 'Report', author: 'me' }
  )
  expect(pdfCalls.length).toBe(1)
  const call = pdfCalls[0]!
  expect(call.path).toBe('/tmp/out.pdf')
  expect(call.pages).toBe(2)
  expect(call.sizes).toEqual([612, 792, 595, 842])
  // Only the first page has a string, so the counts have to say which is whose.
  expect(call.strings).toEqual(['M0 0 L1 0 Z'])
  expect(call.stringCounts).toEqual([1, 0])
  expect(call.metadata[0]).toBe('Report')
  expect(call.metadata[3]).toBe('react-native-tgfx')
})

test('renderToPdf rejects an empty page list', async () => {
  await expect(renderToPdf('/tmp/out.pdf', [])).rejects.toThrow(
    'at least one page'
  )
  expect(pdfCalls.length).toBe(0)
})

test('renderToSvg compiles the tree and passes the viewBox through', async () => {
  const svg = await renderToSvg(<Path path="M0 0 L4 0 Z" color="#0000ff" />, {
    width: 300,
    height: 150,
    textAsPaths: true,
  })
  expect(svg).toBe('<svg/>')
  expect(svgCalls.length).toBe(1)
  const call = svgCalls[0]!
  expect(call.width).toBe(300)
  expect(call.height).toBe(150)
  expect(call.textAsPaths).toBe(true)
  // Decoded, like fromScene: index 0 is the first string, not a carry-over count.
  expect(call.strings).toEqual(['M0 0 L4 0 Z'])
  expect(call.words[3]).toBe(1)
})

test('renderToSvg defaults textAsPaths to false', async () => {
  await renderToSvg(<Rect x={0} y={0} width={1} height={1} />, {
    width: 10,
    height: 10,
  })
  expect(svgCalls[0]!.textAsPaths).toBe(false)
})

test('renderToSvg names itself when the scene is empty', async () => {
  const Boom = (): React.ReactElement => {
    throw new Error('boom')
  }
  await expect(renderToSvg(<Boom />, { width: 8, height: 8 })).rejects.toThrow(
    'renderToSvg'
  )
  expect(svgCalls.length).toBe(0)
})

test('renderToPdf takes a memoised page list without recompiling per call', async () => {
  const pages = [
    {
      width: 100,
      height: 100,
      element: <Rect x={0} y={0} width={1} height={1} />,
    },
  ]
  await renderToPdf('/tmp/a.pdf', pages)
  await renderToPdf('/tmp/b.pdf', pages)
  expect(pdfCalls.map((call) => call.path)).toEqual([
    '/tmp/a.pdf',
    '/tmp/b.pdf',
  ])
  // Each export compiles its own program: the pages are elements, not buffers.
  expect(pdfCalls[0]!.pages).toBe(1)
  expect(pdfCalls[1]!.pages).toBe(1)
})

const { rect, circle, path: pathNode } = await import('../elements')
const { Scene } = await import('../scene')
const { createHandle } = await import('../imperative')

test('a factory-node scene compiles byte-identically to the JSX input', async () => {
  await renderToImage(
    <Rect x={1} y={2} width={3} height={4} color="#ff0000" />,
    {
      width: 16,
      height: 16,
    }
  )
  await renderToImage(
    [rect({ x: 1, y: 2, width: 3, height: 4, color: '#ff0000' })],
    {
      width: 16,
      height: 16,
    }
  )
  expect(calls.length).toBe(2)
  const jsx = calls[0]!.words
  const nodes = calls[1]!.words
  expect(Array.from(nodes.subarray(0, nodes[1]))).toEqual(
    Array.from(jsx.subarray(0, jsx[1]))
  )
  expect(calls[1]!.strings).toEqual(calls[0]!.strings)
})

test('a Scene export bakes live handle writes instead of reseeding them', async () => {
  const box = createHandle()
  const scene = Scene.from([
    rect({ ref: box, x: 0, y: 0, width: 4, height: 4 }),
  ])
  scene.flush()
  await renderToImage(scene, { width: 8, height: 8 })
  // Read now: the scene reuses its writer, so the view aliases the next compile.
  const before = calls[0]!.words[5]
  box.set({ x: 6 })
  await renderToImage(scene, { width: 8, height: 8 })
  expect(calls.length).toBe(2)
  // Header(3) rootCount kind, then x — the write must be in the literals.
  expect(before).toBe(0)
  expect(calls[1]!.words[5]).toBe(6)
})

test('an empty node list rejects like an empty tree', async () => {
  await expect(renderToImage([], { width: 8, height: 8 })).rejects.toThrow(
    'compiled to nothing'
  )
  expect(calls.length).toBe(0)
})

test('renderToPdf pages mix JSX and scene nodes', async () => {
  await renderToPdf('/tmp/mixed.pdf', [
    { width: 100, height: 100, element: <Path path="M0 0 L1 0 Z" /> },
    { width: 200, height: 200, scene: [circle({ cx: 1, cy: 1, r: 1 })] },
    {
      width: 300,
      height: 300,
      scene: Scene.from([pathNode({ path: 'M0 0 L2 0 Z' })]),
    },
  ])
  expect(pdfCalls.length).toBe(1)
  expect(pdfCalls[0]!.pages).toBe(3)
  expect(pdfCalls[0]!.strings).toEqual(['M0 0 L1 0 Z', 'M0 0 L2 0 Z'])
  expect(pdfCalls[0]!.stringCounts).toEqual([1, 0, 1])
})

test('renderToPdf rejects a page with neither or both inputs', async () => {
  await expect(
    renderToPdf('/tmp/bad.pdf', [{ width: 10, height: 10 }])
  ).rejects.toThrow('exactly one of element and scene')
  await expect(
    renderToPdf('/tmp/bad.pdf', [
      {
        width: 10,
        height: 10,
        element: <Rect x={0} y={0} width={1} height={1} />,
        scene: [rect({ x: 0, y: 0, width: 1, height: 1 })],
      },
    ])
  ).rejects.toThrow('exactly one of element and scene')
})

test('renderToSvg takes a Scene with no React anywhere', async () => {
  const svg = await renderToSvg(
    Scene.from([pathNode({ path: 'M0 0 L4 0 Z', color: '#00f' })]),
    { width: 100, height: 50 }
  )
  expect(svg).toBe('<svg/>')
  expect(svgCalls[0]!.strings).toEqual(['M0 0 L4 0 Z'])
})

test('an array of JSX elements still routes through the reconciler', async () => {
  // Host components ARE the tgfx_* strings, so type alone cannot distinguish
  // an element from a factory node — the children array does.
  const items = [0, 1].map((i) => (
    <Rect key={i} x={i} y={0} width={1} height={1} />
  ))
  await renderToImage(items, { width: 8, height: 8 })
  expect(calls.length).toBe(1)
  expect(calls[0]!.words[3]).toBe(2)
})

test('exporting a disposed scene rejects instead of reusing a stale program', async () => {
  const scene = Scene.from([rect({ x: 0, y: 0, width: 1, height: 1 })])
  scene.flush()
  scene.dispose()
  await expect(renderToImage(scene, { width: 8, height: 8 })).rejects.toThrow(
    'disposed'
  )
})

test('a foreign export compile reads live handle state without resetting it', async () => {
  const pushed: number[][] = []
  const sceneTarget = {
    setScene: () => {},
    setValues: (v: number[]) => pushed.push(v.slice()),
  }
  const box = createHandle()
  const node = rect({ ref: box, x: 0, y: 0, width: 4, height: 4 })
  const live = Scene.from([node])
  live.attach(sceneTarget)
  live.flush()
  box.set({ x: 120 })

  // Raw-array export: a fresh writer, reseed=true — foreign to the live scene.
  await renderToImage([node], { width: 8, height: 8 })
  // The export itself reads the live value...
  expect(calls[0]!.words[5]).toBe(120)
  // ...and the live scene keeps it: a later write still patches from 120's
  // slot (no clearOverrides), and a recompile bakes 120, not the factory 0.
  box.set({ y: 7 })
  const lastPush = pushed[pushed.length - 1]!
  expect(lastPush).toContain(120)
  live.add(circle({ cx: 1, cy: 1, r: 1 }))
  live.flush()
  const recompiled = live.compileForExport('test')
  const words = new Float64Array(recompiled.buffer)
  expect(words[5]).toBe(120)
  live.dispose()
})

test('a foreign export leaves a bound shader uniform pool intact', async () => {
  const pushed: number[][] = []
  const sceneTarget = {
    setScene: () => {},
    setValues: (v: number[]) => pushed.push(v.slice()),
  }
  const fx = createHandle()
  const node = rect({ x: 0, y: 0, width: 4, height: 4 }, [
    // @ts-expect-error ref goes through props like every factory
    {
      type: 'tgfx_shader',
      props: {
        ref: fx,
        source:
          'uniform float uLevel;\nhalf4 main(float2 p) { return half4(uLevel, 0.0, 0.0, 1.0); }',
        uniforms: { uLevel: 0.5 },
      },
      children: [],
    },
  ])
  const live = Scene.from([node])
  live.attach(sceneTarget)
  live.flush()

  await renderToImage([node], { width: 8, height: 8 })

  fx.set({ uniforms: { uLevel: 0.9 } })
  const lastPush = pushed[pushed.length - 1]!
  expect(lastPush).toContain(0.9)
  live.dispose()
})

test('a JSX export does not adopt handles bound to a live scene', async () => {
  const pushed: number[][] = []
  const sceneTarget = {
    setScene: () => {},
    setValues: (v: number[]) => pushed.push(v.slice()),
  }
  const box = createHandle()
  const live = Scene.from([rect({ ref: box, x: 0, y: 0, width: 4, height: 4 })])
  live.attach(sceneTarget)
  live.flush()
  box.set({ x: 120 })

  // The reconciler path: a throwaway root compiles the same handle.
  await renderToImage(
    <Rect ref={box as never} x={0} y={0} width={4} height={4} />,
    {
      width: 8,
      height: 8,
    }
  )
  expect(calls[0]!.words[5]).toBe(120) // export reads the live value

  // Ownership stayed with the live scene: a recompile-requiring write still
  // lands (the muted export container would have swallowed it).
  box.set({ y: 9 })
  const lastPush = pushed[pushed.length - 1]!
  expect(lastPush).toContain(120)
  live.add(circle({ cx: 1, cy: 1, r: 1 }))
  live.flush()
  const words = new Float64Array(live.compileForExport('test').buffer)
  expect(words[5]).toBe(120)
  live.dispose()
})
