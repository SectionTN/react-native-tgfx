import { expect, mock, test } from 'bun:test'

// A renamed export must not look like an absent package: that is a silent freeze.
// It throws where the driver renders, not at import: the bindings are not public
// Reanimated API, so a rename must not take down every import of the package.
test('Reanimated present but missing an export throws on render', async () => {
  mock.module('react-native-reanimated', () => ({ stopMapper: () => {} }))
  const { AnimationDriver } =
    (await import('./AnimationDriver?broken')) as typeof import('./AnimationDriver')
  expect(AnimationDriver).not.toBeNull()
  expect(() => AnimationDriver!({ view: {} as never, values: [] })).toThrow(
    /does not export startMapper/
  )
})
