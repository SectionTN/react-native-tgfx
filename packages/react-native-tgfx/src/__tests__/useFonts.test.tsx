import { beforeEach, expect, spyOn, test } from 'bun:test'
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { nativeMocks } from '../testing/nativeMocks'

interface Registered {
  via: 'fromFile' | 'fromBytes' | 'fromBase64'
  arg: string
  family: string
}
let registered: Registered[] = []
let measured: unknown = null
let failing = false

function record(via: Registered['via'], arg: string, family: string): string {
  if (failing) {
    throw new Error('no such face')
  }
  registered.push({ via, arg, family })
  return family || 'Inferred'
}

nativeMocks.hybridObject = () => ({
  registerFromFile: async (path: string, family: string) =>
    record('fromFile', path, family),
  registerFromBytes: async (bytes: ArrayBuffer, family: string) =>
    record('fromBytes', new TextDecoder().decode(bytes), family),
  registerFromBase64: async (data: string, family: string) =>
    record('fromBase64', data, family),
  familyNames: ['Demo Serif'],
  measureText: (text: string, style: unknown) => {
    measured = { text, style }
    return { width: 42, height: 20, ascent: -16, descent: 4, lineCount: 1 }
  },
})

const {
  loadFont,
  measureText,
  useFonts,
  useFontsState,
  registeredFontFamilies,
} = require('../hooks/useFonts') as typeof import('../hooks/useFonts')

beforeEach(() => {
  registered = []
  measured = null
  failing = false
  nativeMocks.assetSource = { uri: '/var/app/PT_Serif.ttf' }
})

test('a bundled font asset is opened natively, never fetched', async () => {
  let fetched = false
  globalThis.fetch = (async () => {
    fetched = true
    throw new Error('should not be reached')
  }) as unknown as typeof fetch
  const family = await loadFont(1 as unknown as number, 'Demo Serif')
  expect(fetched).toBe(false)
  expect(registered).toEqual([
    { via: 'fromFile', arg: '/var/app/PT_Serif.ttf', family: 'Demo Serif' },
  ])
  expect(family).toBe('Demo Serif')
})

test('a Metro-served font arrives as raw bytes', async () => {
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => new TextEncoder().encode('ttf').buffer,
  })) as unknown as typeof fetch
  nativeMocks.assetSource = { uri: 'http://localhost:8081/assets/PT.ttf' }
  await loadFont(1 as unknown as number, 'Demo Serif')
  expect(registered[0]!.via).toBe('fromBytes')
  expect(registered[0]!.arg).toBe('ttf')
})

test('an asset: or content: font is opened natively, never fetched', async () => {
  let fetched = false
  globalThis.fetch = (async () => {
    fetched = true
    throw new Error('should not be reached')
  }) as unknown as typeof fetch
  await loadFont('asset:/fonts/PT.ttf', 'Demo Serif')
  await loadFont('content://com.example.fonts/PT.ttf', 'Demo Serif')
  expect(fetched).toBe(false)
  expect(registered.map((r) => [r.via, r.arg])).toEqual([
    ['fromFile', 'asset:/fonts/PT.ttf'],
    ['fromFile', 'content://com.example.fonts/PT.ttf'],
  ])
})

test('an empty family lets the font name itself', async () => {
  expect(await loadFont('/fonts/PT.ttf')).toBe('Inferred')
  expect(registered[0]!.family).toBe('')
})

test('useFonts registers every face and flips to ready', async () => {
  let ready: boolean | undefined
  function Probe(): null {
    ready = useFonts({
      'Demo Serif': [1 as unknown as number, 2 as unknown as number],
    })
    return null
  }
  await act(async () => {
    TestRenderer.create(<Probe />)
  })
  expect(registered).toHaveLength(2)
  expect(registered.every((r) => r.family === 'Demo Serif')).toBe(true)
  expect(ready).toBe(true)
})

// A boolean cannot tell "still loading" from "failed", leaving the documented gate empty forever.
test('a failed registration surfaces as an error, not a permanent false', async () => {
  failing = true
  const warn = spyOn(console, 'warn').mockImplementation(() => {})
  let state: { ready: boolean; error: Error | null } | undefined
  function Probe(): null {
    state = useFontsState({ 'Demo Serif': [1 as unknown as number] })
    return null
  }
  try {
    await act(async () => {
      TestRenderer.create(<Probe />)
    })
  } finally {
    warn.mockRestore()
  }
  expect(state?.ready).toBe(false)
  expect(state?.error?.message).toBe('no such face')
})

// The record is a literal, so re-running the effect on identity alone would re-register forever.
test('useFonts does not re-register on a re-render with the same fonts', async () => {
  function Probe({ tick }: { tick: number }): null {
    useFonts({ 'Demo Serif': [1 as unknown as number] })
    return tick === -1 ? null : null
  }
  let tree!: TestRenderer.ReactTestRenderer
  await act(async () => {
    tree = TestRenderer.create(<Probe tick={0} />)
  })
  expect(registered).toHaveLength(1)
  await act(async () => {
    tree.update(<Probe tick={1} />)
  })
  expect(registered).toHaveLength(1)
})

test('measureText defaults every field the writer defaults', () => {
  const result = measureText('hi')
  expect(result.width).toBe(42)
  expect(measured).toEqual({
    text: 'hi',
    style: {
      fontSize: 14,
      fontFamily: '',
      fontWeight: 400,
      italic: false,
      fauxBold: false,
      fauxItalic: false,
      letterSpacing: 0,
      width: 0,
      align: 0,
      lineHeight: 0,
      maxLines: 0,
      ellipsis: '',
    },
  })
})

test('measureText passes the style through the way <Text> encodes it', () => {
  measureText('hi', {
    fontSize: 20,
    fontFamily: 'Demo Serif',
    fontWeight: 'bold',
    fontStyle: 'italic',
    width: 100,
    textAlign: 'right',
    maxLines: 2,
    ellipsis: '…',
  })
  expect(measured).toEqual({
    text: 'hi',
    style: {
      fontSize: 20,
      fontFamily: 'Demo Serif',
      fontWeight: 700,
      italic: true,
      fauxBold: false,
      fauxItalic: false,
      letterSpacing: 0,
      width: 100,
      align: 2,
      lineHeight: 0,
      maxLines: 2,
      ellipsis: '…',
    },
  })
})

test('the registered families come straight from native', () => {
  expect(registeredFontFamilies()).toEqual(['Demo Serif'])
})
