import { afterAll, beforeEach, expect, mock, test } from 'bun:test'
import React, { useState } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { compileScene } from '../compiler/compile'
import { SceneWriter } from '../compiler/writer'
import { NodeType, type Node } from '../reconciler/types'
import { nativeMocks } from '../testing/nativeMocks'
import type {
  CameraFrameOptions,
  CameraFrameSource,
  FrameLike,
} from './useCameraFrame'

// A real SharedValue is stable per hook instance and survives re-renders; a
// fresh object each render would hide exactly the identity bugs this checks.
mock.module('react-native-reanimated', () => ({
  useSharedValue: <T,>(initial: T) => useState(() => ({ value: initial }))[0],
}))
mock.module('react-native-worklets', () => ({
  scheduleOnRN: <A extends unknown[]>(fn: (...a: A) => void, ...a: A) => {
    fn(...a)
  },
}))

class FakeImage {
  handle = 7
  width = 720
  height = 1280
  buffers: [bigint, string][] = []
  disposed = false
  setNativeBuffer(pointer: bigint, format: string): void {
    this.buffers.push([pointer, format])
  }
  dispose(): void {
    this.disposed = true
  }
}

let made: FakeImage[] = []
let imported: [bigint, string][] = []
let released = 0
let disposed = 0
/** Set to make the import throw, standing in for any surprise inside the try. */
let importThrows = false

const previousHybrid = nativeMocks.hybridObject
afterAll(() => {
  nativeMocks.hybridObject = previousHybrid
})

beforeEach(() => {
  made = []
  imported = []
  released = 0
  disposed = 0
  importThrows = false
  nativeMocks.hybridObject = () => ({
    fromNativeBuffer(pointer: bigint, format: string) {
      if (importThrows) {
        throw new Error('import failed')
      }
      imported.push([pointer, format])
      const image = new FakeImage()
      made.push(image)
      return image
    },
  })
})

const { useCameraFrame } =
  require('./useCameraFrame') as typeof import('./useCameraFrame')

function frame(over: Partial<FrameLike> = {}): FrameLike {
  return {
    getNativeBuffer: () => ({
      pointer: 0x1000n as never,
      release: () => {
        released++
      },
    }),
    pixelFormat: 'yuv-420-8-bit-video',
    orientation: 'up',
    isMirrored: false,
    width: 720,
    height: 1280,
    dispose: () => {
      disposed++
    },
    ...over,
  }
}

async function mount(
  onEachFrame?: (f: FrameLike) => void,
  options?: CameraFrameOptions
) {
  let seen!: CameraFrameSource
  function Probe(): null {
    seen = useCameraFrame(onEachFrame, options)
    return null
  }
  let tree!: TestRenderer.ReactTestRenderer
  await act(async () => {
    tree = TestRenderer.create(<Probe />)
  })
  return {
    get current() {
      return seen
    },
    async push(over: Partial<FrameLike> = {}) {
      await act(async () => {
        seen.onFrame(frame(over))
      })
    },
    async unmount() {
      await act(async () => {
        tree.unmount()
      })
    },
  }
}

/** The quarter-turn word the draw program carries for a `<CameraFrame>`. */
function quarterTurns(rotation: number): number {
  const node = {
    type: NodeType.CameraFrame,
    props: { image: { handle: 1 }, rotation },
    children: [],
  } as unknown as Node
  const result = compileScene([node], new SceneWriter())
  return new Float64Array(result.buffer)[8]!
}

// The wiring nothing exercised end to end: a ROTATION map with left and right
// transposed passes every other test and only shows as a frame 180 degrees out
// on a real device.
test('an orientation reaches the draw program as the turns that cancel it', async () => {
  const probe = await mount()
  // 'right' means the pixels are +90 from upright, so it takes 270 to undo.
  const cases: [string, number, number][] = [
    ['up', 0, 0],
    ['right', 270, 3],
    ['down', 180, 2],
    ['left', 90, 1],
  ]
  for (const [orientation, rotation, turns] of cases) {
    await probe.push({ orientation })
    expect(probe.current.posture.rotation).toBe(rotation)
    expect(quarterTurns(probe.current.posture.rotation)).toBe(turns)
  }
  // An orientation nobody anticipated must not rotate the frame at all.
  await probe.push({ orientation: 'sideways' })
  expect(probe.current.posture.rotation).toBe(0)
})

test('mirror and frame size come off the frame, and only re-render on a change', async () => {
  let renders = 0
  function Counter(): null {
    renders++
    return null
  }
  let seen!: CameraFrameSource
  function Probe(): null {
    seen = useCameraFrame()
    Counter()
    return null
  }
  await act(async () => {
    TestRenderer.create(<Probe />)
  })
  await act(async () => {
    seen.onFrame(frame({ isMirrored: true }))
  })
  expect(seen.posture).toEqual({
    rotation: 0,
    mirror: true,
    width: 720,
    height: 1280,
  })
  const after = renders
  // Posture is constant for a session; ten more identical frames must not
  // re-render, or the per-frame path is back through React.
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      seen.onFrame(frame({ isMirrored: true }))
    })
  }
  expect(renders).toBe(after)
})

test('the first frame creates the handle and every later one re-points it', async () => {
  const probe = await mount()
  await probe.push()
  expect(made).toHaveLength(1)
  expect(probe.current.image).toBe(made[0] as never)

  await probe.push()
  await probe.push()
  // Still one handle: a second imageFromNativeBuffer would give the scene a new
  // id and force a re-commit per frame.
  expect(made).toHaveLength(1)
  expect(made[0]!.buffers).toHaveLength(2)
})

// An external registry entry is never evicted, so nothing else ever frees this:
// every mount of a camera screen would leak a texture and its hardware buffer.
test('the handle is disposed on unmount', async () => {
  const probe = await mount()
  await probe.push()
  expect(made[0]!.disposed).toBe(false)

  await probe.unmount()
  expect(made[0]!.disposed).toBe(true)

  // Unmounting before a frame ever landed has nothing to dispose and must not
  // throw on the null handle.
  const empty = await mount()
  await empty.unmount()
})

test('the range suffix is read off the frame, not hardcoded', async () => {
  const probe = await mount()
  await probe.push({ pixelFormat: 'yuv-420-8-bit-full' })
  expect(imported[0]![1]).toBe('bt601-full')
  await probe.push({ pixelFormat: 'yuv-420-8-bit-video' })
  expect(made[0]!.buffers[0]![1]).toBe('bt601-limited')
})

// Running it after the finally would hand a detector an already-disposed frame,
// which on device reads as a detector that silently returns nothing.
// A camera is YUV, but the hook is not camera-only: a screen recorder or a
// decoder hands over RGBA, and importing that as BT.601 reads its channels as
// luma and chroma. Rec.709/2020 need their own matrix — the wrong one is a hue
// shift, not an error, so nothing downstream would catch it.
test('a non-YUV producer is not imported as BT.601', async () => {
  const probe = await mount()
  await probe.push({ pixelFormat: 'rgba-8-bit' })
  expect(imported[0]![1]).toBe('rgba')
})

test('the colour matrix follows the producer, not a default', async () => {
  const p709 = await mount()
  await p709.push({ pixelFormat: 'yuv-420-10-bit-bt709-full' })
  expect(imported[0]![1]).toBe('bt709-full')

  imported.length = 0
  made.length = 0
  const p2020 = await mount()
  await p2020.push({ pixelFormat: 'yuv-420-10-bit-bt2020-video' })
  expect(imported[0]![1]).toBe('bt2020-limited')
})

test('the caller can override the format mapping entirely', async () => {
  const probe = await mount(undefined, { format: () => 'jpeg-full' })
  await probe.push({ pixelFormat: 'yuv-420-8-bit-video' })
  expect(imported[0]![1]).toBe('jpeg-full')
})

test('the caller can override the rotation mapping', async () => {
  const probe = await mount(undefined, { rotation: () => 90 })
  await probe.push({ orientation: 'up' })
  expect(probe.current.posture.rotation).toBe(90)
})

test('the caller callback runs while the frame is still alive', async () => {
  const aliveAt: number[] = []
  const probe = await mount(() => {
    aliveAt.push(disposed)
  })
  await probe.push()
  expect(aliveAt).toEqual([0])
  expect(disposed).toBe(1)
})

test('a throw inside still releases the buffer and disposes the frame', async () => {
  const probe = await mount()

  // A surprise from the import itself.
  importThrows = true
  await expect(probe.push()).rejects.toThrow('import failed')
  expect(released).toBe(1)
  expect(disposed).toBe(1)

  // A surprise from the caller's own per-frame work. A leaked frame stalls the
  // producer's bounded pool, so this is the failure that kills the stream.
  importThrows = false
  const boom = await mount(() => {
    throw new Error('detector failed')
  })
  await expect(boom.push()).rejects.toThrow('detector failed')
  expect(released).toBe(2)
  expect(disposed).toBe(2)
})

test('getNativeBuffer throwing still disposes the frame', async () => {
  const probe = await mount()
  await expect(
    probe.push({
      getNativeBuffer: () => {
        throw new Error('no buffer')
      },
    })
  ).rejects.toThrow('no buffer')
  // Nothing to release, but the frame must go back to the pool regardless.
  expect(released).toBe(0)
  expect(disposed).toBe(1)
})
