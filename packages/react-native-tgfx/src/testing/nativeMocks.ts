// Mocks for app-only packages, registered once because `mock.module` is process-wide.
import { mock } from 'bun:test'
import type { ComponentType } from 'react'

export const nativeMocks = {
  assetSource: null as { uri: string } | null,
  hybridObject: (): unknown => ({}),
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
