import { expect, mock, test } from 'bun:test'
import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

// A renamed export must not look like an absent package, and it throws where the driver renders.
test('Reanimated present but missing an export throws on render', async () => {
  mock.module('react-native-reanimated', () => ({ stopMapper: () => {} }))
  const { AnimationDriver } =
    (await import('../reanimated/AnimationDriver?broken')) as typeof import('../reanimated/AnimationDriver')
  expect(AnimationDriver).not.toBeNull()
  expect(() => AnimationDriver!({ view: {} as never, values: [] })).toThrow(
    /does not export startMapper/
  )
})

/** A driver whose mapper runs when the test calls `frame()`. */
async function driverWithFrames() {
  const mappers: (() => void)[] = []
  mock.module('react-native-reanimated', () => ({
    startMapper: (worklet: () => void) => mappers.push(worklet),
    stopMapper: () => {},
  }))
  const { AnimationDriver } =
    (await import('../reanimated/AnimationDriver?frames')) as typeof import('../reanimated/AnimationDriver')
  return { Driver: AnimationDriver!, frame: () => mappers.at(-1)!() }
}

const shared = (value: number) => ({
  value,
  _isReanimatedSharedValue: true as const,
})

/** A mirror block as the driver sees it: boxed, unboxing to the slots' buffers. */
function block(count: number) {
  const values = new ArrayBuffer(count * 8)
  const flags = new ArrayBuffer(1)
  return { values, boxed: { unbox: () => ({ flags, values }) } }
}

function driverProps(
  view: object,
  values: object[],
  mirror: { boxed: object } | null
) {
  return {
    view,
    values,
    strings: [],
    gens: [],
    mirror: mirror?.boxed ?? null,
  } as never
}

test('the driver binds its mirror once and has the view push it each frame', async () => {
  const { Driver, frame } = await driverWithFrames()
  const mirror = block(2)
  const calls: string[] = []
  const view = {
    setValues: () => calls.push('setValues'),
    bindValues: (values: ArrayBuffer) =>
      calls.push(values === mirror.values ? 'bind' : 'bind another'),
    pushValues: () => calls.push('push'),
  }
  const x = shared(3)
  const y = shared(4)
  act(() => {
    TestRenderer.create(
      createElement(Driver, driverProps(view, [x, y], mirror))
    )
  })
  frame()
  x.value = 5
  frame()
  expect(calls).toEqual(['bind', 'push', 'push'])
  expect(Array.from(new Float64Array(mirror.values))).toEqual([5, 4])
})

test('a new value set binds its own mirror before its first push', async () => {
  const { Driver, frame } = await driverWithFrames()
  const first = block(1)
  const second = block(2)
  const calls: string[] = []
  const view = {
    setValues: () => calls.push('setValues'),
    bindValues: (values: ArrayBuffer) =>
      calls.push(
        values === first.values
          ? 'bind first'
          : values === second.values
            ? 'bind second'
            : 'bind another'
      ),
    pushValues: () => calls.push('push'),
  }
  const x = shared(1)
  let tree: TestRenderer.ReactTestRenderer | null = null
  act(() => {
    tree = TestRenderer.create(
      createElement(Driver, driverProps(view, [x], first))
    )
  })
  frame()
  act(() => {
    tree!.update(
      createElement(Driver, driverProps(view, [x, shared(2)], second))
    )
  })
  frame()
  frame()
  expect(calls).toEqual(['bind first', 'push', 'bind second', 'push', 'push'])
})

test('a native view without pushValues, or no mirror, still gets the slot array', async () => {
  const { Driver, frame } = await driverWithFrames()
  const pushed: number[][] = []
  const older = { setValues: (values: number[]) => pushed.push(values.slice()) }
  act(() => {
    TestRenderer.create(
      createElement(Driver, driverProps(older, [shared(3)], block(1)))
    )
  })
  frame()
  const unmirrored = { ...older, bindValues: () => {}, pushValues: () => {} }
  act(() => {
    TestRenderer.create(
      createElement(Driver, driverProps(unmirrored, [shared(7)], null))
    )
  })
  frame()
  expect(pushed).toEqual([[3], [7]])
})
