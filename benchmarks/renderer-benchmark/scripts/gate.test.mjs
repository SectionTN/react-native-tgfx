import { describe, expect, test } from 'bun:test'
import { rejectReason } from './gate.mjs'

const good = (overrides = {}) => ({
  platform: 'android',
  renderer: 'tgfx',
  objects: 400,
  duration: 15,
  thermalAfter: { status: 1 },
  previousStartedAtEpochMs: 1000,
  result: {
    config: { renderer: 'tgfx', objectCount: 400 },
    startedAtEpochMs: 2000,
    native: {
      wallTimeMs: 15040,
      device: { thermalStatusStart: 1, thermalStatusEnd: 1 },
    },
  },
  ...overrides,
})

const withResult = (options, patch) => {
  const base = good(options)
  return {
    ...base,
    result: {
      ...base.result,
      ...patch,
      config: { ...base.result.config, ...patch.config },
      native: { ...base.result.native, ...patch.native },
    },
  }
}

describe('rejectReason', () => {
  const images = (proof) =>
    withResult(
      { renderer: 'tgfx-images' },
      {
        config: { renderer: 'tgfx-images' },
        backendProof: proof,
      }
    )

  test('the bitmap scene has to have had bitmaps to draw', () => {
    expect(
      rejectReason(
        images({ textures: 4, texturePixels: 262144, imageNodes: 400 })
      )
    ).toBeNull()
    // The failure this exists for: a full set of timings for an empty scene.
    expect(
      rejectReason(images({ textures: 0, texturePixels: 0, imageNodes: 0 }))
    ).toMatch(/drew 0 textures/)
    expect(rejectReason(images(undefined))).toMatch(/drew undefined textures/)
    // The before side cannot report decoded dimensions — the base64 transport
    // never exposed them to JS — so the count and the node census are what both
    // sides are held to.
    expect(
      rejectReason(images({ textures: 4, imageNodes: 400 }))
    ).toBeNull()
    expect(
      rejectReason(images({ textures: 4, texturePixels: 262144, imageNodes: 3 }))
    ).toMatch(/3 image nodes/)
  })

  test('accepts a clean run on both platforms', () => {
    expect(rejectReason(good())).toBeNull()
    expect(rejectReason(good({ platform: 'ios', thermalAfter: undefined }))).toBeNull()
  })

  test('rejects a run whose renderer or object count is not the one requested', () => {
    for (const platform of ['android', 'ios']) {
      expect(
        rejectReason(withResult({ platform }, { config: { renderer: 'thor-gpu' } }))
      ).toMatch(/renderer thor-gpu/)
      expect(
        rejectReason(withResult({ platform }, { config: { objectCount: 3200 } }))
      ).toMatch(/objectCount 3200/)
    }
  })

  test('rejects a measurement window outside -100/+300 ms on both platforms', () => {
    for (const platform of ['android', 'ios']) {
      expect(rejectReason(withResult({ platform }, { native: { wallTimeMs: 14899 } }))).toMatch(
        /wallTimeMs/
      )
      expect(rejectReason(withResult({ platform }, { native: { wallTimeMs: 15301 } }))).toMatch(
        /wallTimeMs/
      )
      expect(rejectReason(withResult({ platform }, { native: { wallTimeMs: 14900 } }))).toBeNull()
      expect(rejectReason(withResult({ platform }, { native: { wallTimeMs: 15300 } }))).toBeNull()
    }
  })

  test('rejects a result that is not newer than the last accepted one', () => {
    for (const platform of ['android', 'ios']) {
      expect(rejectReason(withResult({ platform }, { startedAtEpochMs: 1000 }))).toMatch(
        /stale result/
      )
      expect(rejectReason(withResult({ platform }, { startedAtEpochMs: 999 }))).toMatch(
        /stale result/
      )
    }
  })

  test('accepts the first run of a campaign, which has no predecessor', () => {
    const { previousStartedAtEpochMs, ...first } = good()
    expect(rejectReason(first)).toBeNull()
  })

  // #91: a gate that passes when the field it reads is absent is not a gate.
  test('rejects rather than passes when a checked field is missing or NaN', () => {
    expect(rejectReason(good({ result: {} }))).toMatch(/no config or native metrics/)
    expect(rejectReason(good({ result: undefined }))).toMatch(/no config or native metrics/)
    expect(rejectReason(withResult({}, { native: { wallTimeMs: undefined } }))).toMatch(
      /wallTimeMs/
    )
    expect(rejectReason(withResult({}, { native: { wallTimeMs: Number.NaN } }))).toMatch(
      /wallTimeMs/
    )
    expect(rejectReason(withResult({}, { startedAtEpochMs: undefined }))).toMatch(/stale result/)
    expect(rejectReason(withResult({}, { native: { device: undefined } }))).toMatch(
      /thermalStatusStart/
    )
    expect(rejectReason(good({ thermalAfter: undefined }))).toMatch(/post-run thermal status/)
    expect(rejectReason(good({ platform: 'web' }))).toMatch(/unknown platform/)
  })

  test('applies the thermal conjuncts on Android', () => {
    expect(
      rejectReason(withResult({}, { native: { device: { thermalStatusStart: 2 } } }))
    ).toMatch(/thermalStatusStart 2/)
    expect(
      rejectReason(
        withResult({}, { native: { device: { thermalStatusStart: 0, thermalStatusEnd: 1 } } })
      )
    ).toMatch(/thermal drifted/)
    expect(rejectReason(good({ thermalAfter: { status: 2 } }))).toMatch(/post-run thermal/)
  })

  // BenchmarkMetrics.swift hardcodes both to 0, so checking them on iOS would
  // be a tautology; the Simulator also has no post-run thermal to read.
  test('skips the thermal conjuncts on iOS instead of evaluating them', () => {
    const ios = withResult(
      { platform: 'ios', thermalAfter: undefined },
      { native: { device: { thermalStatusStart: 0, thermalStatusEnd: 0 } } }
    )
    expect(rejectReason(ios)).toBeNull()
    expect(rejectReason({ ...ios, result: { ...ios.result, native: { ...ios.result.native, device: undefined } } })).toBeNull()
  })
})
