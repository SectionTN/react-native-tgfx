import { expect, mock, test } from 'bun:test'
import type * as TestRenderer from 'react-test-renderer'

// A renamed export must not look like an absent package, and it throws where the hook runs.
test('Reanimated present but missing an export throws when the hook runs', async () => {
  mock.module('react-native-reanimated', () => ({ useSharedValue: () => {} }))
  const { useClock } =
    (await import('./useClock?broken')) as typeof import('./useClock')
  expect(() => useClock()).toThrow(/does not export useFrameCallback/)
})

test('the clock reads the frame time and keeps one callback identity', async () => {
  const shared = { value: 0, _isReanimatedSharedValue: true as const }
  let registered: ((frame: { timeSinceFirstFrame: number }) => void) | null =
    null
  const seen: unknown[] = []
  mock.module('react-native-reanimated', () => ({
    useSharedValue: () => shared,
    useFrameCallback: (
      cb: (frame: { timeSinceFirstFrame: number }) => void
    ) => {
      registered = cb
      seen.push(cb)
    },
  }))
  const { useClock } = await import('./useClock?live')
  const React = await import('react')
  const TestRenderer = await import('react-test-renderer')

  let got: unknown
  function Probe(): null {
    got = useClock()
    return null
  }
  let tree!: TestRenderer.ReactTestRenderer
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(React.createElement(Probe))
  })
  expect(got).toBe(shared)

  // Seconds, not milliseconds: a ms clock overflows GLSL ES mediump in a minute.
  registered!({ timeSinceFirstFrame: 250 })
  expect(shared.value).toBe(0.25)

  await TestRenderer.act(async () => {
    tree.update(React.createElement(Probe))
  })
  expect(seen).toHaveLength(2)
  expect(seen[1]).toBe(seen[0])
})

test('createClock ticks seconds on the UI loop and stops cleanly', async () => {
  const loops: ((t: number) => void)[] = []
  mock.module('react-native-reanimated', () => ({
    makeMutable: <T>(initial: T) => ({ value: initial }),
  }))
  mock.module('react-native-worklets', () => ({
    scheduleOnUI: (worklet: () => void) => {
      const g = globalThis as { requestAnimationFrame?: unknown }
      const previous = g.requestAnimationFrame
      g.requestAnimationFrame = (cb: (t: number) => void) => {
        loops.push(cb)
      }
      try {
        worklet()
      } finally {
        g.requestAnimationFrame = previous
      }
    },
  }))
  const { createClock } =
    (await import('./useClock?create')) as typeof import('./useClock')
  const clock = createClock()
  expect(loops.length).toBe(1)
  loops[0]!(1000)
  expect(clock.value.value).toBe(0) // first frame defines t=0
  loops[1]!(3500)
  expect(clock.value.value).toBe(2.5)
  clock.stop()
  const queued = loops[loops.length - 1]!
  queued(9000)
  expect(clock.value.value).toBe(2.5) // stopped: no further writes
})
