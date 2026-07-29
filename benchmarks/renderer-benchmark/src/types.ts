export type RendererId = 'skia-graphite' | 'thor-cpu' | 'thor-gpu' | 'tgfx'

export type Shape =
  | {
      kind: 'rect'
      key: number
      x: number
      y: number
      width: number
      height: number
      color: string
      stroke: string
      strokeWidth: number
    }
  | {
      kind: 'circle'
      key: number
      cx: number
      cy: number
      radius: number
      color: string
      stroke: string
      strokeWidth: number
    }
  | {
      kind: 'line'
      key: number
      x1: number
      y1: number
      x2: number
      y2: number
      color: string
      strokeWidth: number
    }
  | {
      kind: 'polygon'
      key: number
      points: number[]
      color: string
      stroke: string
      strokeWidth: number
    }

export type BenchmarkConfig = {
  renderer: RendererId
  objectCount: number
  mainThreadPressureMs: number
  warmupSeconds: number
  durationSeconds: number
  seed: number
}

export type FrameStats = {
  fps: number
  frameCount: number
  missedFrames: number
  p50Ms: number
  p90Ms: number
  p95Ms: number
  p99Ms: number
  maxMs: number
}

export type NativeMetrics = {
  mainThread: FrameStats
  processCpuPercent: number
  wallTimeMs: number
  processCpuTimeMs: number
  memory: {
    startPssKb: number
    endPssKb: number
    peakPssKb: number
    startNativeHeapKb: number
    endNativeHeapKb: number
    peakNativeHeapKb: number
    startJavaHeapKb: number
    endJavaHeapKb: number
    peakJavaHeapKb: number
  }
  device: {
    refreshRateHz: number
    thermalStatusStart: number
    thermalStatusEnd: number
    batteryTemperatureStartC: number
    batteryTemperatureEndC: number
  }
}

export type BenchmarkResult = {
  schemaVersion: 1
  config: BenchmarkConfig
  backendProof: Record<string, string | number | boolean>
  viewport: { width: number; height: number }
  js: FrameStats
  native: NativeMetrics
  startedAtEpochMs: number
  completedAtEpochMs: number
}
