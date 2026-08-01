// iOS Simulator counterpart of run-quick.mjs. Same workload and metric windows;
// the published result is read from the app container instead of logcat.
//
// Usage: node scripts/run-quick-ios.mjs --tag=baseline [--renderers=tgfx] [--reps=3]
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const artifacts = resolve(root, 'artifacts')
const udid = process.env.IOS_UDID ?? '7A4BDE99-7B36-4E71-98D3-CA3A0B2B07E5'
const session = 'rb-ios'
const bundleId = 'org.reactjs.native.example.RendererBenchmark'
const labels = {
  'skia-graphite': 'Skia Graphite',
  'thor-cpu': 'Thor CPU',
  'thor-gpu': 'Thor GPU',
  tgfx: 'Tgfx GPU',
}

const arg = (name, fallback) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback

const tag = arg('tag', 'quick')
const renderers = arg('renderers', 'tgfx').split(',')
const reps = Number(arg('reps', '3'))
const objects = Number(arg('objects', '400'))
const duration = Number(arg('duration', '15'))
const warmup = 5
const seed = 20260729

const agent = (args) =>
  execFileSync(
    'agent-device',
    [...args, '--session', session, '--platform', 'ios', '--udid', udid],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
  )
const simctl = (args) =>
  execFileSync('xcrun', ['simctl', ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const records = []
mkdirSync(artifacts, { recursive: true })
const outputPath = resolve(artifacts, `quick-ios-${tag}.json`)

for (let rep = 0; rep < reps; rep += 1) {
  for (const renderer of renderers) {
    agent(['open', bundleId, '--relaunch'])
    agent(['wait', 'text', 'Renderer stress benchmark', '30000'])
    agent(['press', `role=button label="${labels[renderer]}"`, '--settle'])
    agent(['press', `role=button label="${objects}"`, '--settle'])
    agent(['press', `role=button label="${warmup}s"`, '--settle'])
    agent(['press', `role=button label="${duration}s"`, '--settle'])
    agent(['press', `role=button label="${seed}"`, '--settle'])
    agent(['press', 'role=button label="Start benchmark"'])
    await sleep((warmup + duration + 3) * 1000)
    agent(['wait', 'text', 'Benchmark complete', '15000'])
    await sleep(500)

    // simctl prints an unrelated getpwuid_r warning first; the path is last.
    const container = simctl(['get_app_container', udid, bundleId, 'data'])
      .trim()
      .split('\n')
      .at(-1)
      .trim()
    const result = JSON.parse(
      readFileSync(resolve(container, 'Documents', 'benchmark-result.json'), 'utf8')
    )
    if (result.config.renderer !== renderer) {
      throw new Error(`stale result: ${result.config.renderer} != ${renderer}`)
    }
    records.push({ tag, rep: rep + 1, renderer, result })
    writeFileSync(outputPath, `${JSON.stringify(records, null, 2)}\n`)
    process.stdout.write(
      `rep=${rep + 1} ${renderer} js=${result.js.fps.toFixed(2)} ` +
        `main=${result.native.mainThread.fps.toFixed(2)} ` +
        `cpu=${result.native.processCpuPercent.toFixed(1)}%\n`
    )
  }
}

process.stdout.write(`\n=== ios ${tag} (median of ${reps}) ===\n`)
for (const renderer of renderers) {
  const own = records.filter((record) => record.renderer === renderer)
  const pick = (fn) => median(own.map(fn)).toFixed(2)
  process.stdout.write(
    `${renderer.padEnd(14)} jsFps=${pick((r) => r.result.js.fps)} ` +
      `jsP99=${pick((r) => r.result.js.p99Ms)}ms ` +
      `mainFps=${pick((r) => r.result.native.mainThread.fps)} ` +
      `mainP99=${pick((r) => r.result.native.mainThread.p99Ms)}ms ` +
      `cpu=${pick((r) => r.result.native.processCpuPercent)}% ` +
      `footprint=${(median(own.map((r) => r.result.native.memory.peakPssKb)) / 1024).toFixed(1)}MB\n`
  )
}
process.stdout.write(`saved ${records.length} runs to ${outputPath}\n`)
