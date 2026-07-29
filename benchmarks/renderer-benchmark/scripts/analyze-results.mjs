import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runs = JSON.parse(readFileSync(resolve(root, 'artifacts/raw-runs.json'), 'utf8'))
const rendererOrder = ['skia-graphite', 'thor-cpu', 'thor-gpu', 'tgfx']

function quantile(values, probability) {
  const sorted = [...values].sort((first, second) => first - second)
  const index = (sorted.length - 1) * probability
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) {
    return sorted[lower]
  }
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower)
}

function stats(values) {
  const q1 = quantile(values, 0.25)
  const median = quantile(values, 0.5)
  const q3 = quantile(values, 0.75)
  return {
    values,
    median,
    q1,
    q3,
    iqr: q3 - q1,
    min: Math.min(...values),
    max: Math.max(...values),
  }
}

const selectors = {
  jsFps: (run) => run.result.js.fps,
  jsMissedFrames: (run) => run.result.js.missedFrames,
  jsP99Ms: (run) => run.result.js.p99Ms,
  mainCallbackFps: (run) => run.result.native.mainThread.fps,
  mainMissedFrames: (run) => run.result.native.mainThread.missedFrames,
  mainP99Ms: (run) => run.result.native.mainThread.p99Ms,
  processCpuPercentOfOneCore: (run) => run.result.native.processCpuPercent,
  processCpuTimeMs: (run) => run.result.native.processCpuTimeMs,
  startPssMb: (run) => run.result.native.memory.startPssKb / 1024,
  endPssMb: (run) => run.result.native.memory.endPssKb / 1024,
  peakPssMb: (run) => run.result.native.memory.peakPssKb / 1024,
  peakMinusStartPssMb: (run) =>
    (run.result.native.memory.peakPssKb -
      run.result.native.memory.startPssKb) /
    1024,
  endMinusStartPssMb: (run) =>
    (run.result.native.memory.endPssKb -
      run.result.native.memory.startPssKb) /
    1024,
  peakNativeHeapMb: (run) =>
    run.result.native.memory.peakNativeHeapKb / 1024,
  peakJavaHeapMb: (run) => run.result.native.memory.peakJavaHeapKb / 1024,
  gfxinfoTotalFrames: (run) => run.gfxInfo.totalFrames,
  gfxinfoJankyPercent: (run) => run.gfxInfo.jankyPercent,
}

const summary = {
  schemaVersion: 1,
  acceptedRuns: runs.length,
  repetitionsPerRenderer: 5,
  quantileMethod: 'R-7 linear interpolation',
  renderers: {},
}

for (const renderer of rendererOrder) {
  const rendererRuns = runs.filter(
    (run) => run.result.config.renderer === renderer
  )
  summary.renderers[renderer] = {
    runIndices: rendererRuns.map((run) => run.runIndex),
    metrics: Object.fromEntries(
      Object.entries(selectors).map(([name, select]) => [
        name,
        stats(rendererRuns.map(select)),
      ])
    ),
  }
}

writeFileSync(
  resolve(root, 'artifacts/results-summary.json'),
  `${JSON.stringify(summary, null, 2)}\n`
)

for (const renderer of rendererOrder) {
  const metrics = summary.renderers[renderer].metrics
  process.stdout.write(
    [
      renderer,
      `JS ${metrics.jsFps.median.toFixed(2)}`,
      `CPU ${metrics.processCpuPercentOfOneCore.median.toFixed(1)}%`,
      `peak PSS ${metrics.peakPssMb.median.toFixed(1)} MB`,
      `PSS growth ${metrics.peakMinusStartPssMb.median.toFixed(1)} MB`,
      `main ${metrics.mainCallbackFps.median.toFixed(2)}`,
      `gfx jank ${metrics.gfxinfoJankyPercent.median.toFixed(2)}%`,
    ].join(' | ') + '\n'
  )
}
