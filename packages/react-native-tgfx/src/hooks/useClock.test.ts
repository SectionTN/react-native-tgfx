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
