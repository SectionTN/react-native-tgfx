// Mocks for app-only packages, registered once because `mock.module` is process-wide.
import { mock } from 'bun:test'
import type { ComponentType } from 'react'

export const nativeMocks = {
  assetSource: null as { uri: string } | null,
  hybridObject: (): unknown => ({}),
  hostComponent: (() => null) as ComponentType<never>,
  /// createHybridObject invocations — the number the singleton tests assert on.
  /// hybridObject() itself now fires per method dispatch (see the proxy below).
  hybridCreations: 0,
}

mock.module('react-native', () => ({
  Image: { resolveAssetSource: () => nativeMocks.assetSource },
}))

mock.module('react-native-nitro-modules', () => ({
  NitroModules: {
    // A delegating proxy, not the mock itself: production code caches hybrid
    // objects in module singletons, so the first test file to touch a factory
    // would otherwise lock every later file to its mock. The proxy re-reads
    // nativeMocks.hybridObject per call, so a beforeEach swap always lands.
    createHybridObject: () => (
      nativeMocks.hybridCreations++,
      new Proxy(
        {},
        {
          // Only `get` is trapped: `in`, spread and Object.keys see an empty
          // object, and every access re-invokes hybridObject() — keep mock
          // state in closures, never on the returned object.
          get: (_target, prop) =>
            (nativeMocks.hybridObject() as Record<PropertyKey, unknown>)[prop],
        }
      )
    ),
  },
  callback: (fn: unknown) => fn,
  getHostComponent: () => nativeMocks.hostComponent,
}))
