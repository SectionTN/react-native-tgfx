import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runs = JSON.parse(
  readFileSync(resolve(root, 'artifacts/hard-raw-runs.json'), 'utf8')
)
const renderers = ['skia-graphite', 'thor-cpu', 'thor-gpu', 'tgfx']

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
  mainThreadFps: (run) => run.result.native.mainThread.fps,
  mainThreadP99Ms: (run) => run.result.native.mainThread.p99Ms,
  mainThreadMissedFrames: (run) => run.result.native.mainThread.missedFrames,
  jsFps: (run) => run.result.js.fps,
  processCpuPercent: (run) => run.result.native.processCpuPercent,
  peakPssMb: (run) => run.result.native.memory.peakPssKb / 1024,
  gfxinfoJankyPercent: (run) => run.gfxInfo.jankyPercent,
}

const summary = {
  schemaVersion: 1,
  config: {
    objectCount: 3200,
    drawNodes: 6401,
    mainThreadPressureMsPerVsync: 15,
    warmupSeconds: 5,
    measuredSeconds: 15,
    repetitions: 3,
  },
  acceptedRuns: runs.length,
  renderers: Object.fromEntries(
    renderers.map((renderer) => {
      const rendererRuns = runs.filter((run) => run.renderer === renderer)
      return [
        renderer,
        {
          runIndices: rendererRuns.map((run) => run.runIndex),
          metrics: Object.fromEntries(
            Object.entries(selectors).map(([name, selector]) => [
              name,
              stats(rendererRuns.map(selector)),
            ])
          ),
        },
      ]
    })
  ),
}

writeFileSync(
  resolve(root, 'artifacts/hard-results-summary.json'),
  `${JSON.stringify(summary, null, 2)}\n`
)

for (const renderer of renderers) {
  const metrics = summary.renderers[renderer].metrics
  process.stdout.write(
    `${renderer} | main ${metrics.mainThreadFps.median.toFixed(2)} | p99 ${metrics.mainThreadP99Ms.median.toFixed(1)}ms | missed ${metrics.mainThreadMissedFrames.median.toFixed(0)} | JS ${metrics.jsFps.median.toFixed(2)} | CPU ${metrics.processCpuPercent.median.toFixed(1)}% | PSS ${metrics.peakPssMb.median.toFixed(1)}MB\n`
  )
}
