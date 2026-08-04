import { beforeEach, expect, mock, test } from 'bun:test'
import React, { StrictMode, useEffect, useLayoutEffect, useState } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { nativeMocks } from '../testing/nativeMocks'
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

// Scene word layout is [VERSION, wordCount, patchTableStart, rootNodeCount, ...].
let scenes: number[][] = []
let pushed: number[][] = []
let invalidated = 0

function FakeView({ hybridRef }: { hybridRef: (ref: unknown) => void }): null {
  useEffect(() => {
    hybridRef({
      setScene: (buffer: ArrayBuffer) => {
        const words = new Float64Array(buffer)
        scenes.push(Array.from(words.subarray(0, words[1])))
      },
      setValues: (values: number[]) => pushed.push(values.slice()),
      invalidate: () => invalidated++,
    })
  }, [hybridRef])
  return null
}

mock.module('react-native-reanimated', () => ({
  startMapper: () => 0,
  stopMapper: () => {},
  makeMutable: (value: number) => ({
    value,
    _isReanimatedSharedValue: true,
  }),
}))
nativeMocks.hostComponent = FakeView as never

// Synchronous: a top-level await lets another test file's mock.module land first.
const { Canvas } = require('./Canvas') as typeof import('./Canvas')
const { Rect, Path, Text } =
  require('./drawings') as typeof import('./drawings')

function Star(): React.ReactElement {
  return <Path path="M0 0L1 1" color="gold" />
}

function Toggle({ custom }: { custom: boolean }): React.ReactElement {
  return (
    <Canvas>
      <Rect x={0} y={0} width={10} height={10} color="red" />
      {custom ? <Star /> : null}
    </Canvas>
  )
}

const rootCounts = () => scenes.map((words) => words[3])

const SCENE = (
  <Canvas>
    <Rect x={0} y={0} width={10} height={10} color="red" />
  </Canvas>
)

async function render(
  element: React.ReactElement
): Promise<TestRenderer.ReactTestRenderer> {
  let tree!: TestRenderer.ReactTestRenderer
  await act(async () => {
    tree = TestRenderer.create(element)
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
  return tree
}

beforeEach(() => {
  scenes = []
  pushed = []
  invalidated = 0
})

// StrictMode re-runs effects on remount but not the render body that builds the root.
test('a static scene reaches the native view after a StrictMode remount', async () => {
  await render(SCENE)
  const plain = scenes.at(-1)
  expect(plain?.[3]).toBe(1)

  scenes = []
  await render(<StrictMode>{SCENE}</StrictMode>)

  expect(scenes.at(-1)).toEqual(plain!)
})

test('switching from the fallback path back to the direct one keeps the scene', async () => {
  const tree = await render(<Toggle custom />)
  expect(scenes.at(-1)![3]).toBe(2)

  scenes = []
  await act(async () => {
    tree.update(<Toggle custom={false} />)
    await new Promise((resolve) => setTimeout(resolve, 50))
  })

  expect(scenes.at(-1)![3]).toBe(1)
  expect(rootCounts()).not.toContain(0)
})

test('the paths keep swapping without losing the scene', async () => {
  const tree = await render(<Toggle custom />)
  for (const custom of [false, true, false]) {
    await act(async () => {
      tree.update(<Toggle custom={custom} />)
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(scenes.at(-1)![3]).toBe(custom ? 2 : 1)
  }
  expect(rootCounts()).not.toContain(0)
})

test('unmounting still tears the root down', async () => {
  const tree = await render(SCENE)
  expect(scenes.at(-1)![3]).toBe(1)

  await act(async () => {
    tree.unmount()
    await new Promise((resolve) => setTimeout(resolve, 20))
  })

  expect(scenes.at(-1)![3]).toBe(0)
})

// ---- Imperative node handles ----

// A single <Rect> starts at word 4: [kind, x, y, width, height, ...paint].
const X = 5
const { useNode } = require('../imperative') as typeof import('../imperative')

type NodeHandleLike = ReturnType<typeof useNode>
let box!: NodeHandleLike
let rerender!: () => void

function Handled(): React.ReactElement {
  const [, setTick] = useState(0)
  box = useNode()
  rerender = () => setTick((t) => t + 1)
  return (
    <Canvas>
      <Rect ref={box} x={0} y={0} width={10} height={10} color="red" />
    </Canvas>
  )
}

test('a written prop reaches the engine without a React render or a re-encode', async () => {
  await render(<Handled />)
  expect(scenes.at(-1)![X]).toBe(0)
  scenes = []

  await act(async () => box.set({ x: 120 }))

  // Slots exist for every patchable prop the element carries, so even the first
  // write is a value patch.
  expect(scenes).toEqual([])
  expect(pushed).toEqual([[120, 0, 10, 10]])
})

test('writing a slotted prop again still patches values', async () => {
  await render(<Handled />)
  scenes = []
  await act(async () => box.set({ x: 200 }))
  await act(async () => box.set({ x: 240 }))

  expect(scenes).toEqual([])
  expect(pushed.map((values) => values[0])).toEqual([200, 240])
})

test('a prop with no slot re-encodes every write', async () => {
  await render(<Handled />)
  scenes = []

  await act(async () => box.set({ color: '#ff00ff' }))
  await act(async () => box.set({ color: '#00ff00' }))

  expect(scenes.length).toBe(2)
  expect(pushed).toEqual([])
})

test('a write from a worklet patches the slot and never touches JS', async () => {
  await render(<Handled />)
  scenes = []
  const globals = globalThis as { _WORKLET?: boolean }
  globals._WORKLET = true
  try {
    await act(async () => box.set({ x: 180 }))
  } finally {
    delete globals._WORKLET
  }

  // On the UI thread the write itself wakes the driver's mapper, so nothing is
  // pushed from here and nothing is re-encoded.
  expect(scenes).toEqual([])
  expect(pushed).toEqual([])
  await act(async () => box.set({ y: 5 }))
  expect(pushed).toEqual([[180, 5, 10, 10]])
})

test('the next React commit takes the node back', async () => {
  await render(<Handled />)
  await act(async () => box.set({ x: 120 }))
  expect(pushed.at(-1)![0]).toBe(120)

  await act(async () => {
    rerender()
    await new Promise((resolve) => setTimeout(resolve, 20))
  })

  expect(scenes.at(-1)![X]).toBe(0)
})

test('redraw() forces a frame without a commit', async () => {
  const canvas = React.createRef<import('../types').CanvasHandle>()
  await render(<Canvas ref={canvas}>{SCENE.props.children}</Canvas>)
  scenes = []

  canvas.current!.redraw()

  expect(invalidated).toBe(1)
  expect(scenes).toEqual([])
})

// The reconciler path attaches the ref itself, which must not disturb it.
function Boxed({ handle }: { handle: NodeHandleLike }): React.ReactElement {
  return <Rect ref={handle} x={0} y={0} width={10} height={10} color="red" />
}

function BoxedScene(): React.ReactElement {
  box = useNode()
  return (
    <Canvas>
      <Boxed handle={box} />
    </Canvas>
  )
}

test('a handle works through the reconciler path too', async () => {
  await render(<BoxedScene />)
  scenes = []

  await act(async () => box.set({ x: 90 }))

  expect(scenes).toEqual([])
  expect(pushed).toEqual([[90, 0, 10, 10]])
})

// `Text`'s wrap width is patchable-looking but the compiler writes it as a
// literal, so an override is not proof of a slot: every write has to re-encode.
function Labelled(): React.ReactElement {
  box = useNode()
  return (
    <Canvas>
      <Text ref={box} x={0} y={10} text="hi" width={100} />
    </Canvas>
  )
}

test('a slot-shaped prop the compiler writes as a literal re-encodes every time', async () => {
  await render(<Labelled />)
  scenes = []

  await act(async () => box.set({ width: 200 }))
  await act(async () => box.set({ width: 300 }))

  expect(scenes.length).toBe(2)
  // [kind, x, y, textIndex, fontSize, ...font, width]
  expect(scenes.at(-1)!).toContain(300)
})

function Toggled({ show }: { show: boolean }): React.ReactElement {
  box = useNode()
  return (
    <Canvas>
      {show ? (
        <Rect ref={box} x={0} y={0} width={10} height={10} color="red" />
      ) : null}
    </Canvas>
  )
}

test('a write made while the node is unmounted does not outlive its remount', async () => {
  const tree = await render(<Toggled show />)
  await act(async () => {
    tree.update(<Toggled show={false} />)
    await new Promise((resolve) => setTimeout(resolve, 20))
  })

  await act(async () => box.set({ color: '#00ff00' }))
  scenes = []
  await act(async () => {
    tree.update(<Toggled show />)
    await new Promise((resolve) => setTimeout(resolve, 20))
  })

  // 0xFFFF0000: the JSX red, not the green written while it was gone.
  expect(scenes.at(-1)!).toContain(4294901760)
})

// A layout effect runs before the passive effect the canvas compiles in, so
// this write happens while the handle has no program behind it yet.
function EarlyWrite(): React.ReactElement {
  box = useNode()
  useLayoutEffect(() => {
    box.set({ color: '#00ff00' })
  }, [])
  return (
    <Canvas>
      <Rect ref={box} x={0} y={0} width={10} height={10} color="red" />
    </Canvas>
  )
}

test('a write made before the first compile survives it', async () => {
  await render(<EarlyWrite />)

  expect(scenes.at(-1)!).toContain(4278255360)
})
