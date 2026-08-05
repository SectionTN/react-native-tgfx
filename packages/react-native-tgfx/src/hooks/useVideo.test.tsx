import { afterAll, beforeEach, expect, mock, test } from 'bun:test'
import React, { useState } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { nativeMocks } from '../testing/nativeMocks'
import type { VideoOptions, Video } from './useVideo'

let tick: (() => void) | null = null

mock.module('react-native-reanimated', () => ({
  useSharedValue: <T,>(initial: T) => useState(() => ({ value: initial }))[0],
  useFrameCallback: (cb: () => void) => {
    tick = cb
  },
}))
mock.module('react-native-worklets', () => ({
  scheduleOnRN: <A extends unknown[]>(fn: (...a: A) => void, ...a: A) => {
    fn(...a)
  },
}))

class FakeImage {
  handle = 3
  width = 640
  height = 480
  buffers: [bigint, string][] = []
  disposed = false
  setNativeBuffer(pointer: bigint, format: string): void {
    this.buffers.push([pointer, format])
  }
  dispose(): void {
    this.disposed = true
  }
}

class FakeVideo {
  duration = 5000
  framerate = 30
  rotation = 90
  width = 640
  height = 480
  pixelFormat = 'bt709-limited'
  currentTime = 0
  paused = true
  looping = false
  volume = 1
  released = false
  seeks: number[] = []
  frames: bigint[] = []
  acquireFrame(): bigint {
    return this.frames.shift() ?? 0n
  }
  seek(millis: number): void {
    this.seeks.push(millis)
  }
  release(): void {
    this.released = true
  }
}

let made: FakeImage[] = []
let opened: FakeVideo[] = []
let loadFails = false

const previousHybrid = nativeMocks.hybridObject
afterAll(() => {
  nativeMocks.hybridObject = previousHybrid
})

beforeEach(() => {
  made = []
  opened = []
  loadFails = false
  tick = null
  nativeMocks.assetSource = { uri: 'file:///clip.mp4' }
  nativeMocks.hybridObject = () => ({
    async load(uri: string) {
      if (loadFails) {
        throw new Error(`cannot open ${uri}`)
      }
      const video = new FakeVideo()
      opened.push(video)
      return video
    },
    fromNativeBuffer() {
      const image = new FakeImage()
      made.push(image)
      return image
    },
  })
})

const { useVideo, loadVideo } =
  require('./useVideo') as typeof import('./useVideo')

async function mount(
  source: number | string = 'file:///clip.mp4',
  options?: VideoOptions
) {
  let seen!: Video
  function Probe({ opts }: { opts?: VideoOptions }): null {
    seen = useVideo(source, opts)
    return null
  }
  let tree!: TestRenderer.ReactTestRenderer
  await act(async () => {
    tree = TestRenderer.create(<Probe opts={options} />)
  })
  return {
    get current() {
      return seen
    },
    get video() {
      return opened[0]!
    },
    async pump() {
      await act(async () => {
        tick?.()
      })
    },
    async setOptions(next: VideoOptions) {
      await act(async () => {
        tree.update(<Probe opts={next} />)
      })
    },
    async unmount() {
      await act(async () => {
        tree.unmount()
      })
    },
  }
}

test('metadata comes off the player once it is open', async () => {
  const probe = await mount()
  expect(probe.current.duration).toBe(5000)
  expect(probe.current.framerate).toBe(30)
  expect(probe.current.rotation).toBe(90)
  expect(probe.current.size).toEqual({ width: 640, height: 480 })
})

test('the first frame creates the handle and every later one re-points it', async () => {
  const probe = await mount()
  probe.video.frames.push(0x1000n, 0x2000n)

  await probe.pump()
  expect(made).toHaveLength(1)
  expect(probe.current.currentFrame).toBe(made[0] as never)

  await probe.pump()
  expect(made).toHaveLength(1)
  expect(made[0]!.buffers).toEqual([[0x2000n, 'bt709-limited']])
})

// A tick with nothing decoded must leave the last frame up, not blank the canvas.
test('a tick with no new frame leaves the handle alone', async () => {
  const probe = await mount()
  probe.video.frames.push(0x1000n)
  await probe.pump()
  await probe.pump()
  expect(made).toHaveLength(1)
  expect(made[0]!.buffers).toHaveLength(0)
})

test('currentTime follows the player on every tick', async () => {
  const probe = await mount()
  probe.video.currentTime = 1234
  await probe.pump()
  expect(probe.current.currentTime.value).toBe(1234)
})

test('options reach the player, and a new seek seeks again', async () => {
  const probe = await mount('file:///clip.mp4', { looping: true, volume: 0.5 })
  expect(probe.video.paused).toBe(false)
  expect(probe.video.looping).toBe(true)
  expect(probe.video.volume).toBe(0.5)

  await probe.setOptions({ paused: true, seek: 2000 })
  expect(probe.video.paused).toBe(true)
  expect(probe.video.seeks).toEqual([2000])
})

// A device has a handful of hardware decoders; one leaked per mount runs out fast.
test('unmounting releases the player and disposes the handle', async () => {
  const probe = await mount()
  probe.video.frames.push(0x1000n)
  await probe.pump()

  await probe.unmount()
  expect(probe.video.released).toBe(true)
  expect(made[0]!.disposed).toBe(true)
})

test('a failing source is a warning, not a crash', async () => {
  loadFails = true
  const probe = await mount()
  expect(probe.current.currentFrame).toBeNull()
  expect(probe.current.duration).toBe(0)
  await probe.pump()
})

// resolveAssetSource throws synchronously, and an effect that throws takes the screen down.
test('an unresolvable asset is a warning, not a crash', async () => {
  nativeMocks.assetSource = null
  const probe = await mount(1 as unknown as string)
  expect(probe.current.currentFrame).toBeNull()
  expect(opened).toHaveLength(0)
})

// Releasing the player closes the buffer the handle points at, so the handle goes first.
test('unmount disposes the handle before releasing the player', async () => {
  const order: string[] = []
  const probe = await mount()
  probe.video.frames.push(0x1000n)
  await probe.pump()
  made[0]!.dispose = () => order.push('dispose')
  probe.video.release = () => order.push('release')

  await probe.unmount()
  expect(order).toEqual(['dispose', 'release'])
})

test('a require()d asset is resolved to its uri', async () => {
  nativeMocks.assetSource = { uri: 'file:///bundled.mp4' }
  const video = await loadVideo(1 as unknown as number)
  expect(video).toBe(opened[0] as never)
})
