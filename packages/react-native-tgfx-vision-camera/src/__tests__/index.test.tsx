import { expect, mock, test } from 'bun:test'
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'

const sinks: FakeSink[] = []

class FakeSink {
  attached: number[] = []
  detachCount = 0
  frameCount = 0
  attach(_output: unknown, handle: number): void {
    this.attached.push(handle)
  }
  detach(): void {
    this.detachCount++
  }
}

mock.module('react-native-nitro-modules', () => ({
  NitroModules: {
    createHybridObject: () => {
      const sink = new FakeSink()
      sinks.push(sink)
      return sink
    },
  },
}))

const { useTgfxCameraSink } = await import('../index')

function Host({ id }: { id: number }): null {
  const sink = useTgfxCameraSink()
  sink.attach({} as never, id)
  return null
}

async function mount(id: number): Promise<TestRenderer.ReactTestRenderer> {
  let tree!: TestRenderer.ReactTestRenderer
  await act(async () => {
    tree = TestRenderer.create(<Host id={id} />)
  })
  return tree
}

test('detaches on unmount, so a torn-down camera stops writing to a dead handle', async () => {
  const tree = await mount(7)
  const sink = sinks.at(-1)!
  expect(sink.attached).toEqual([7])
  expect(sink.detachCount).toBe(0)

  await act(async () => {
    tree.unmount()
  })
  expect(sink.detachCount).toBe(1)
})

test('one sink per mount, and a re-render does not mint another', async () => {
  const before = sinks.length
  const tree = await mount(1)
  await act(async () => {
    tree.update(<Host id={2} />)
  })
  expect(sinks.length).toBe(before + 1)
  // The same instance saw both attaches; a fresh sink would strand the first on the output.
  expect(sinks.at(-1)!.attached).toEqual([1, 2])
  await act(async () => {
    tree.unmount()
  })
})
