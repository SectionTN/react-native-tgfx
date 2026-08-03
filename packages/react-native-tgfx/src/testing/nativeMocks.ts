// Mocks for the packages that only exist inside a running app.
//
// `mock.module` is process-wide, so a test file that replaces one of these with
// just the exports it needs deletes the rest for every other file in the run.
// They are therefore registered once, here, with the whole export surface; what
// varies per test goes through the mutable hooks below.
import { mock } from 'bun:test'
import type { ComponentType } from 'react'

export const nativeMocks = {
  /** What `Image.resolveAssetSource` returns. */
  assetSource: null as { uri: string } | null,
  /** What `NitroModules.createHybridObject()` returns. */
  hybridObject: (): unknown => ({}),
  /** What `getHostComponent` returns. Read when the view module is required. */
  hostComponent: (() => null) as ComponentType<never>,
}

mock.module('react-native', () => ({
  Image: { resolveAssetSource: () => nativeMocks.assetSource },
}))

mock.module('react-native-nitro-modules', () => ({
  NitroModules: {
    createHybridObject: () => nativeMocks.hybridObject(),
  },
  callback: (fn: unknown) => fn,
  getHostComponent: () => nativeMocks.hostComponent,
}))
