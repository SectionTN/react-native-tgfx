import { expect, mock, test } from 'bun:test'
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'

let assetUri: { uri: string } | null = { uri: 'https://example.test/a.png' }
mock.module('react-native', () => ({
  Image: { resolveAssetSource: () => assetUri },
}))

const { useImageState } = require('./useImage') as typeof import('./useImage')

function reply(body: string, ok = true, status = 200) {
  return {
    ok,
    status,
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  }
}

async function mount(source: string) {
  let seen!: ReturnType<typeof useImageState>
  function Probe({ src }: { src: string }): null {
    seen = useImageState(src)
    return null
  }
  let tree!: TestRenderer.ReactTestRenderer
  await act(async () => {
    tree = TestRenderer.create(<Probe src={source} />)
  })
  return {
    get state() {
      return seen
    },
    async setSource(next: string) {
      await act(async () => {
        tree.update(<Probe src={next} />)
      })
    },
  }
}

test('a successful load reports data and stops loading', async () => {
  globalThis.fetch = (async () => reply('hi')) as unknown as typeof fetch
  const probe = await mount('https://example.test/a.png')
  expect(probe.state.data).toBe('aGk=')
  expect(probe.state.error).toBeNull()
  expect(probe.state.loading).toBe(false)
})

test('a 404 is a failure, and its body is never decoded as an image', async () => {
  globalThis.fetch = (async () =>
    reply('<html>not found</html>', false, 404)) as unknown as typeof fetch
  const probe = await mount('https://example.test/missing.png')
  expect(probe.state.data).toBeNull()
  expect(probe.state.error?.message).toMatch(/HTTP 404/)
  expect(probe.state.loading).toBe(false)
})

test('a failing new source clears the previous image rather than keeping it', async () => {
  globalThis.fetch = (async () => reply('hi')) as unknown as typeof fetch
  const probe = await mount('https://example.test/a.png')
  expect(probe.state.data).toBe('aGk=')

  globalThis.fetch = (async () =>
    reply('nope', false, 500)) as unknown as typeof fetch
  await probe.setSource('https://example.test/b.png')
  expect(probe.state.data).toBeNull()
  expect(probe.state.error?.message).toMatch(/HTTP 500/)
})

test('a raw base64 source is passed through', async () => {
  const probe = await mount('aGk=')
  expect(probe.state.data).toBe('aGk=')
  expect(probe.state.loading).toBe(false)
})

test('a slow new source clears the old image immediately, not when it settles', async () => {
  globalThis.fetch = (async () => reply('hi')) as unknown as typeof fetch
  const probe = await mount('https://example.test/a.png')
  expect(probe.state.data).toBe('aGk=')

  // Never settles: the old bytes must not stay on screen while it is in flight.
  globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch
  await probe.setSource('https://example.test/slow.png')
  expect(probe.state.data).toBeNull()
  expect(probe.state.loading).toBe(true)
})

test('an unresolvable asset is an error, not a silent freeze', async () => {
  assetUri = null
  const probe = await mount(1 as unknown as string)
  assetUri = { uri: 'https://example.test/a.png' }
  expect(probe.state.data).toBeNull()
  expect(probe.state.error?.message).toMatch(/could not resolve asset source/)
  expect(probe.state.loading).toBe(false)
})

test('a slow old source cannot overwrite the result of a newer one', async () => {
  let releaseOld!: (v: unknown) => void
  globalThis.fetch = ((url: string) =>
    url.includes('old')
      ? new Promise((r) => {
          releaseOld = r
        })
      : Promise.resolve(reply('new'))) as unknown as typeof fetch

  const probe = await mount('https://example.test/old.png')
  expect(probe.state.data).toBeNull()

  await probe.setSource('https://example.test/new.png')
  expect(probe.state.data).toBe('bmV3')

  // The old fetch lands last; its cleanup already ran, so it must not write.
  await act(async () => {
    releaseOld(reply('old'))
  })
  expect(probe.state.data).toBe('bmV3')
})

test('a failed source recovers when a working one replaces it', async () => {
  globalThis.fetch = (async () =>
    reply('nope', false, 404)) as unknown as typeof fetch
  const probe = await mount('https://example.test/missing.png')
  expect(probe.state.error).not.toBeNull()

  globalThis.fetch = (async () => reply('hi')) as unknown as typeof fetch
  await probe.setSource('https://example.test/a.png')
  expect(probe.state.data).toBe('aGk=')
  expect(probe.state.error).toBeNull()
})

test('the pending state cannot be poisoned by a caller', async () => {
  globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch
  const probe = await mount('https://example.test/slow.png')
  expect(() => {
    ;(probe.state as { data: string | null }).data = 'POISON'
  }).toThrow()
  const second = await mount('https://example.test/other.png')
  expect(second.state.data).toBeNull()
})
