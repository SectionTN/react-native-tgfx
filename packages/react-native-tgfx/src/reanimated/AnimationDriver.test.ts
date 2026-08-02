import { expect, mock, test } from 'bun:test'

// A renamed export must not look like an absent package: that is a silent freeze.
test('Reanimated present but missing an export throws', async () => {
  mock.module('react-native-reanimated', () => ({ stopMapper: () => {} }))
  // `?broken` keeps the permanently-cached failed evaluation off the real module's key.
  await expect(import('./AnimationDriver?broken')).rejects.toThrow(
    /does not export startMapper\/stopMapper/
  )
})
