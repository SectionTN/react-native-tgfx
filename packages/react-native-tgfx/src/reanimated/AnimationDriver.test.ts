import { expect, mock, test } from 'bun:test'

// A renamed export must not look like an absent package: that is a silent freeze.
test('Reanimated present but missing an export throws', async () => {
  mock.module('react-native-reanimated', () => ({ stopMapper: () => {} }))
  expect(import('./AnimationDriver')).rejects.toThrow(
    /does not export startMapper\/stopMapper/
  )
})
