// Acceptance gate for a published benchmark result, shared by run-quick.mjs and
// run-quick-ios.mjs so both harnesses reject the same bad runs.
//
// Both harnesses select the whole configuration by pressing buttons by
// accessibility label, so "did the run I just recorded use the parameters I
// asked for" is the thing worth checking, and it is platform-independent.
//
// The thermal conjuncts are deliberately Android-only: BenchmarkMetrics.swift
// reports thermalStatusStart/End as a hardcoded 0 and the Simulator exposes no
// thermalservice to read after the run, so evaluating them on iOS would be a
// tautology dressed up as a check. Every comparison is written so that a
// missing or NaN field rejects rather than passes.
//
// `platform` is the gate family ('android'/'ios'), not a record's `platform`
// stamp ('android-device'/'ios-simulator'); passing a stamp rejects as unknown.
//
// Returns null when the run is acceptable, otherwise why it was rejected.
export function rejectReason({
  platform,
  result,
  renderer,
  objects,
  duration,
  thermalAfter,
  previousStartedAtEpochMs = -Infinity,
}) {
  const config = result?.config
  const native = result?.native
  if (!config || !native) {
    return 'result has no config or native metrics'
  }
  if (config.renderer !== renderer) {
    return `renderer ${config.renderer} != ${renderer}`
  }
  if (config.objectCount !== objects) {
    return `objectCount ${config.objectCount} != ${objects}`
  }
  // A renderer id proves which component mounted, not that it drew anything: an
  // earlier run of this same benchmark published a full set of frame timings for
  // a scene with no visible content. The bitmap scene therefore has to report
  // what it actually had in hand.
  if (renderer === 'tgfx-images') {
    const proof = result.backendProof
    if (!(proof?.textures >= 1)) {
      return `tgfx-images drew ${proof?.textures} textures`
    }
    if (!(proof.imageNodes >= objects * 0.5)) {
      return `tgfx-images drew ${proof.imageNodes} image nodes for ${objects} objects`
    }
  }
  const low = duration * 1000 - 100
  const high = duration * 1000 + 300
  if (!(native.wallTimeMs >= low && native.wallTimeMs <= high)) {
    return `wallTimeMs ${native.wallTimeMs} outside ${low}..${high}`
  }
  // iOS reads the result out of a file the app overwrites, so a run that never
  // republished leaves the previous one in place with the same parameters.
  if (!(result.startedAtEpochMs > previousStartedAtEpochMs)) {
    return `stale result: startedAtEpochMs ${result.startedAtEpochMs} not newer than ${previousStartedAtEpochMs}`
  }
  if (platform === 'ios') {
    return null
  }
  if (platform !== 'android') {
    return `unknown platform ${platform}`
  }
  if (!(native.device?.thermalStatusStart <= 1)) {
    return `thermalStatusStart ${native.device?.thermalStatusStart} > 1`
  }
  if (native.device.thermalStatusEnd !== native.device.thermalStatusStart) {
    return `thermal drifted ${native.device.thermalStatusStart} -> ${native.device.thermalStatusEnd}`
  }
  if (!(thermalAfter?.status <= 1)) {
    return `post-run thermal status ${thermalAfter?.status} > 1`
  }
  return null
}
