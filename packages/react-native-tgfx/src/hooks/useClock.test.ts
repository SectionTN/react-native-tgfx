import { expect, mock, test } from 'bun:test'
import type * as TestRenderer from 'react-test-renderer'

// A renamed export must not look like an absent package: that is a silent freeze.
test('Reanimated present but missing an export throws', async () => {
  mock.module('react-native-reanimated', () => ({ useSharedValue: () => {} }))
  // `?broken` keeps the permanently-cached failed evaluation off the real module's key.
  await expect(import('./useClock?broken')).rejects.toThrow(
    /does not export useSharedValue\/useFrameCallback/
  )
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

  registered!({ timeSinceFirstFrame: 250 })
  expect(shared.value).toBe(250)

  // A fresh callback each render would re-register and reset the clock to zero.
  await TestRenderer.act(async () => {
    tree.update(React.createElement(Probe))
  })
  expect(seen).toHaveLength(2)
  expect(seen[1]).toBe(seen[0])
})
