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

/** A driver whose live mappers all run when the test calls `frame()`, as Reanimated's would. */
async function driverWithFrames() {
  const mappers = new Map<number, () => void>()
  let next = 1
  mock.module('react-native-reanimated', () => ({
    startMapper: (worklet: () => void) => {
      mappers.set(next, worklet)
      return next++
    },
    stopMapper: (id: number) => mappers.delete(id),
  }))
  const { AnimationDriver } =
    (await import('../reanimated/AnimationDriver?frames')) as typeof import('../reanimated/AnimationDriver')
  return {
    Driver: AnimationDriver!,
    frame: () => {
      for (const run of mappers.values()) {
        run()
      }
    },
  }
}

/** The native contract: a bind keeps the buffer, a push copies it now, and a recycle unbinds. */
function nativeView() {
  let bound: ArrayBuffer | null = null
  const received: number[][] = []
  const arrays: number[][] = []
  return {
    received,
    arrays,
    recycle: () => {
      bound = null
    },
    setValues: (values: number[]) => {
      arrays.push(values.slice())
    },
    bindValues: (values: ArrayBuffer) => {
      bound = values
    },
    pushValues: () => {
      if (bound == null) {
        return false
      }
      received.push(Array.from(new Float64Array(bound)))
      return true
    },
  }
}

const shared = (value: number) => ({
  value,
  _isReanimatedSharedValue: true as const,
})

/** A mirror block as the driver sees it: boxed, unboxing to the slots' buffers. */
function block(count: number) {
  const values = new ArrayBuffer(count * 8)
  const flags = new ArrayBuffer(1)
  return { values, flags, boxed: { unbox: () => ({ flags, values }) } }
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

test('each frame the view copies that frame values from the mirror', async () => {
  const { Driver, frame } = await driverWithFrames()
  const mirror = block(2)
  const view = nativeView()
  const x = shared(3)
  act(() => {
    TestRenderer.create(
      createElement(Driver, driverProps(view, [x, shared(4)], mirror))
    )
  })
  frame()
  x.value = 5
  frame()
  expect(view.received).toEqual([
    [3, 4],
    [5, 4],
  ])
  expect(view.arrays).toEqual([])
  expect(new Uint8Array(mirror.flags)[0]).toBe(1)
})

test('a new value set binds its own mirror before its first push', async () => {
  const { Driver, frame } = await driverWithFrames()
  const view = nativeView()
  const x = shared(1)
  let tree: TestRenderer.ReactTestRenderer | null = null
  act(() => {
    tree = TestRenderer.create(
      createElement(Driver, driverProps(view, [x], block(1)))
    )
  })
  frame()
  act(() => {
    tree!.update(
      createElement(Driver, driverProps(view, [x, shared(20)], block(2)))
    )
  })
  frame()
  expect(view.received).toEqual([[1], [1, 20]])
})

test('a view that lost its binding to a recycle is bound again on the next frame', async () => {
  const { Driver, frame } = await driverWithFrames()
  const view = nativeView()
  const x = shared(1)
  act(() => {
    TestRenderer.create(createElement(Driver, driverProps(view, [x], block(1))))
  })
  frame()
  view.recycle()
  x.value = 2
  frame()
  expect(view.received).toEqual([[1], [2]])
})

test('a native view without pushValues, or no mirror, still gets the slot array', async () => {
  const { Driver, frame } = await driverWithFrames()
  const pushed: number[][] = []
  const older = { setValues: (values: number[]) => pushed.push(values.slice()) }
  let first: TestRenderer.ReactTestRenderer | null = null
  act(() => {
    first = TestRenderer.create(
      createElement(Driver, driverProps(older, [shared(3)], block(1)))
    )
  })
  frame()
  act(() => {
    first!.unmount()
  })
  const unmirrored = { ...nativeView(), setValues: older.setValues }
  act(() => {
    TestRenderer.create(
      createElement(Driver, driverProps(unmirrored, [shared(7)], null))
    )
  })
  frame()
  expect(pushed).toEqual([[3], [7]])
})
