import { beforeEach, expect, test } from 'bun:test'
import React from 'react'
import { nativeMocks } from './testing/nativeMocks'

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
  nativeMocks.hybridObject = () => ({
    savePdf: (
      path: string,
      pages: ArrayBuffer[],
      strings: string[],
      stringCounts: number[],
      sizes: number[],
      metadata: string[]
    ) => {
      pdfCalls.push({ path, pages: pages.length, strings, stringCounts, sizes, metadata })
      return Promise.resolve()
    },
    fromScene: (
      words: ArrayBuffer,
      strings: string[],
      width: number,
      height: number,
      pixelRatio: number,
      opaque: boolean
    ) => {
      calls.push({
        words: new Float64Array(words),
        strings,
        width,
        height,
        pixelRatio,
        opaque,
      })
      return Promise.resolve({ handle: 1 })
    },
  })
})

const { renderToImage, renderToPdf } = await import('./offscreen')
const { Rect, Path } = await import('./components/drawings')

test('renderToImage compiles the tree and hands over the options', async () => {
  await renderToImage(<Rect x={1} y={2} width={3} height={4} color="#ff0000" />, {
    width: 64,
    height: 32,
    pixelRatio: 2,
    opaque: true,
  })
  expect(calls.length).toBe(1)
  const call = calls[0]!
  expect(call.width).toBe(64)
  expect(call.height).toBe(32)
  expect(call.pixelRatio).toBe(2)
  expect(call.opaque).toBe(true)
  expect(call.words[3]).toBe(1) // one root node
})

test('renderToImage defaults pixelRatio and opaque', async () => {
  await renderToImage(<Rect x={0} y={0} width={1} height={1} />, {
    width: 8,
    height: 8,
  })
  expect(calls[0]!.pixelRatio).toBe(1)
  expect(calls[0]!.opaque).toBe(false)
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
  await expect(renderToImage(<Boom />, { width: 8, height: 8 })).rejects.toThrow(
    'compiled to nothing'
  )
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
      { width: 595, height: 842, element: <Rect x={0} y={0} width={1} height={1} /> },
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
  await expect(renderToPdf('/tmp/out.pdf', [])).rejects.toThrow('at least one page')
  expect(pdfCalls.length).toBe(0)
})
