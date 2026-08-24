import { afterAll, beforeEach, expect, mock, test } from 'bun:test'
import React, { useState } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { nativeMocks } from '../testing/nativeMocks'
import type { VideoOptions, Video } from '../hooks/useVideo'

let tick: (() => void) | null = null

let uiLoops: ((t: number) => void)[] = []

mock.module('react-native-reanimated', () => ({
  makeMutable: <T,>(initial: T) => ({ value: initial }),
  useSharedValue: <T,>(initial: T) => useState(() => ({ value: initial }))[0],
  useFrameCallback: (cb: () => void) => {
    tick = cb
  },
}))
mock.module('react-native-worklets', () => ({
  scheduleOnRN: <A extends unknown[]>(fn: (...a: A) => void, ...a: A) => {
    fn(...a)
  },
  scheduleOnUI: (worklet: () => void) => {
    // The loop registers itself through requestAnimationFrame; capture the
    // callback so tests can drive frames by hand.
    const previous = (globalThis as { requestAnimationFrame?: unknown })
      .requestAnimationFrame
    ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame =
      (cb: (t: number) => void) => {
        uiLoops.push(cb)
      }
    try {
      worklet()
    } finally {
      ;(
        globalThis as { requestAnimationFrame?: unknown }
      ).requestAnimationFrame = previous
    }
  },
}))

class FakeVideo {
  duration = 5000
  framerate = 30
  rotation = 90
  width = 640
  height = 480
  currentTime = 0
  paused = true
  looping = false
  volume = 1
  released = false
  seeks: number[] = []
  frames: number[] = []
  updateFrame(): number {
    return this.frames.shift() ?? 0
  }
  seek(millis: number): void {
    this.seeks.push(millis)
  }
  release(): void {
    this.released = true
  }
}

let opened: FakeVideo[] = []
let loadFails = false

const previousHybrid = nativeMocks.hybridObject
afterAll(() => {
  nativeMocks.hybridObject = previousHybrid
})

beforeEach(() => {
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
  })
})

const { useVideo, loadVideo } =
  require('../hooks/useVideo') as typeof import('../hooks/useVideo')

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

test('the first frame reaches React, and a later one with the same id does not', async () => {
  const probe = await mount()
  probe.video.frames.push(7, 7)

  await probe.pump()
  const frame = probe.current.currentFrame
  expect(frame).toEqual({ handle: 7, width: 640, height: 480 })

  // The id is stable, so a re-render per frame would be pure waste.
  await probe.pump()
  expect(probe.current.currentFrame).toBe(frame as never)
})

// A tick with nothing decoded must leave the last frame up, not blank the canvas.
test('a tick with no new frame leaves the frame alone', async () => {
  const probe = await mount()
  probe.video.frames.push(7)
  await probe.pump()
  await probe.pump()
  expect(probe.current.currentFrame).toEqual({
    handle: 7,
    width: 640,
    height: 480,
  })
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
test('unmounting releases the player, which owns the frame', async () => {
  const probe = await mount()
  probe.video.frames.push(7)
  await probe.pump()

  await probe.unmount()
  expect(probe.video.released).toBe(true)
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

// A frame from the released player must never be pulled again.
test('the pump stops after unmount', async () => {
  const probe = await mount()
  probe.video.frames.push(7)
  await probe.pump()
  await probe.unmount()

  let pulled = false
  probe.video.updateFrame = () => {
    pulled = true
    return 7
  }
  await probe.pump()
  expect(pulled).toBe(false)
})

test('a require()d asset is resolved to its uri', async () => {
  nativeMocks.assetSource = { uri: 'file:///bundled.mp4' }
  const video = await loadVideo(1 as unknown as number)
  expect(video).toBe(opened[0] as never)
})

test('createVideoPlayer opens, applies options, pumps, and disposes', async () => {
  uiLoops = []
  const { createVideoPlayer } =
    require('../hooks/useVideo') as typeof import('../hooks/useVideo')
  const player = await createVideoPlayer('file:///clip.mp4', {
    looping: true,
    volume: 0.5,
    seek: 1500,
  })
  const video = opened[0]!
  expect(video.paused).toBe(false)
  expect(video.looping).toBe(true)
  expect(video.volume).toBe(0.5)
  expect(video.seeks).toEqual([1500])
  expect(player.duration).toBe(5000)
  expect(player.rotation).toBe(90)
  expect(player.size).toEqual({ width: 640, height: 480 })
  expect(player.currentFrame).toBeNull()

  const frames: unknown[] = []
  player.onFrame((f) => frames.push(f))
  video.frames.push(7)
  video.currentTime = 250
  expect(uiLoops.length).toBe(1)
  // Drive one UI frame by hand: the loop re-queues itself.
  uiLoops[0]!(16)
  expect(player.currentFrame).toEqual({ handle: 7, width: 640, height: 480 })
  expect(frames.length).toBe(1)
  expect(player.currentTime.value).toBe(250)

  player.setOptions({ paused: true, seek: 900 })
  expect(video.paused).toBe(true)
  expect(video.seeks).toEqual([1500, 900])

  player.dispose()
  expect(video.released).toBe(true)
  expect(player.duration).toBe(0)
  // The stopped loop must go quiet, not throw.
  const queued = uiLoops[uiLoops.length - 1]!
  expect(() => queued(32)).not.toThrow()
})
