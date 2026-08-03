import { beforeEach, expect, mock, test } from 'bun:test'
import React, { StrictMode, useEffect } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { nativeMocks } from '../testing/nativeMocks'
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

// Scene word layout is [VERSION, wordCount, patchTableStart, rootNodeCount, ...].
let scenes: number[][] = []

function FakeView({ hybridRef }: { hybridRef: (ref: unknown) => void }): null {
  useEffect(() => {
    hybridRef({
      setScene: (buffer: ArrayBuffer) => {
        const words = new Float64Array(buffer)
        scenes.push(Array.from(words.subarray(0, words[1])))
      },
    })
  }, [hybridRef])
  return null
}

mock.module('react-native-reanimated', () => ({
  startMapper: () => 0,
  stopMapper: () => {},
}))
nativeMocks.hostComponent = FakeView as never

// Synchronous: a top-level await lets another test file's mock.module land first.
const { Canvas } = require('./Canvas') as typeof import('./Canvas')
const { Rect, Path } = require('./drawings') as typeof import('./drawings')

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
