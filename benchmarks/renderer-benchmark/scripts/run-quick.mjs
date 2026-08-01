// Short A/B campaign used while iterating on a renderer.
//
// Same workload, gates and metric windows as run-campaign.mjs, but only the
// renderers and repetition count you ask for, written to its own tagged file so
// a before/after pair can be compared directly.
//
// Usage: node scripts/run-quick.mjs --tag=baseline [--renderers=tgfx,thor-gpu]
//                                   [--reps=3] [--objects=400] [--duration=15]
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const artifacts = resolve(root, 'artifacts')
const serial = process.env.ANDROID_SERIAL ?? 'RZCW30KE1NB'
const session = 'renderer-benchmark'
const app = 'com.rendererbenchmark'
const labels = {
  'skia-graphite': 'Skia Graphite',
  'thor-cpu': 'Thor CPU',
  'thor-gpu': 'Thor GPU',
  tgfx: 'Tgfx GPU',
  'tgfx-animated': 'Tgfx Animated',
}

const arg = (name, fallback) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback

const tag = arg('tag', 'quick')
const renderers = arg('renderers', 'tgfx').split(',')
const reps = Number(arg('reps', '3'))
const objects = Number(arg('objects', '400'))
const duration = Number(arg('duration', '15'))
const seed = 20260729
const warmup = 5

function run(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    throw new Error(
      `${command} ${args.join(' ')}\n${error.stdout ?? ''}\n${error.stderr ?? ''}`
    )
  }
}

const agent = (args) =>
  run('agent-device', [...args, '--session', session, '--platform', 'android', '--serial', serial])
const adb = (args) => run('adb', ['-s', serial, ...args])

function thermal() {
  const raw = adb(['shell', 'dumpsys', 'thermalservice'])
  return {
    status: Number(raw.match(/Thermal Status:\s*(\d+)/)?.[1] ?? -1),
    skinC: Number(raw.match(/mValue=([\d.]+).*mName=SKIN,\s*mStatus/)?.[1] ?? Number.NaN),
    batteryC: Number(raw.match(/mValue=([\d.]+).*mName=BAT,\s*mStatus/)?.[1] ?? Number.NaN),
  }
}

function wake() {
  adb(['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'])
  adb(['shell', 'wm', 'dismiss-keyguard'])
  adb(['shell', 'cmd', 'statusbar', 'collapse'])
}

function waitForThermalGate() {
  let sleeping = false
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const state = thermal()
    // The device settles at thermal status 1 after a few runs and never drops
    // back to 0, so the gate is a stable-and-cool check plus the thor-gpu
    // control run, which reveals any drift between sessions.
    if (state.status <= 1 && state.skinC <= 36.8 && state.batteryC <= 35) {
      wake()
      return state
    }
    if (!sleeping) {
      adb(['shell', 'input', 'keyevent', 'KEYCODE_SLEEP'])
      sleeping = true
    }
    process.stdout.write(
      `cooldown status=${state.status} skin=${state.skinC.toFixed(1)}C bat=${state.batteryC.toFixed(1)}C\n`
    )
    run('sleep', ['15'])
  }
  throw new Error('Thermal gate was not reached')
}

function parsePublishedResult(logcat) {
  const candidates = logcat
    .split('\n')
    .filter((line) => line.includes('RendererBenchmark'))
    .map((line) => line.slice(line.indexOf('{"schemaVersion"')))
    .filter((line) => line.startsWith('{'))
  if (candidates.length === 0) {
    throw new Error('No RendererBenchmark result in logcat')
  }
  return JSON.parse(candidates.at(-1))
}

function parseGfxInfo(raw) {
  const number = (pattern) => {
    const value = raw.match(pattern)?.[1]
    return value === undefined ? null : Number(value)
  }
  return {
    totalFrames: number(/Total frames rendered:\s*(\d+)/),
    jankyPercent: number(/Janky frames:\s*\d+\s*\(([\d.]+)%\)/),
    p95Ms: number(/95th percentile:\s*(\d+)ms/),
    p99Ms: number(/99th percentile:\s*(\d+)ms/),
    missedVsync: number(/Number Missed Vsync:\s*(\d+)/),
  }
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const records = []
mkdirSync(artifacts, { recursive: true })
const outputPath = resolve(artifacts, `quick-${tag}.json`)

for (let rep = 0; rep < reps; rep += 1) {
  for (const renderer of renderers) {
    let attempts = 0
    for (;;) {
      attempts += 1
      const thermalBefore = waitForThermalGate()
      process.stdout.write(
        `run rep=${rep + 1}/${reps} renderer=${renderer} skin=${thermalBefore.skinC.toFixed(1)}C\n`
      )
      agent(['open', app, '--relaunch'])
      agent(['wait', 'text', 'Renderer stress benchmark', '15000'])
      agent(['press', `role=button label="${labels[renderer]}"`, '--settle'])
      agent(['press', `role=button label="${objects}"`, '--settle'])
      agent(['press', `role=button label="${warmup}s"`, '--settle'])
      agent(['press', `role=button label="${duration}s"`, '--settle'])
      agent(['press', `role=button label="${seed}"`, '--settle'])
      adb(['logcat', '-c'])
      adb(['shell', 'dumpsys', 'gfxinfo', app, 'reset'])
      agent(['press', 'role=button label="Start benchmark"'])
      agent(['wait', String((warmup + duration + 2) * 1000)])
      agent(['wait', 'text', 'Benchmark complete', '8000'])
      const result = parsePublishedResult(adb(['logcat', '-d']))
      const gfxInfo = parseGfxInfo(adb(['shell', 'dumpsys', 'gfxinfo', app, 'framestats']))
      const thermalAfter = thermal()
      const valid =
        result.config.renderer === renderer &&
        result.config.objectCount === objects &&
        result.native.wallTimeMs >= duration * 1000 - 100 &&
        result.native.wallTimeMs <= duration * 1000 + 300 &&
        result.native.device.thermalStatusStart <= 1 &&
        result.native.device.thermalStatusEnd ===
          result.native.device.thermalStatusStart &&
        thermalAfter.status <= 1
      if (!valid) {
        process.stdout.write(`  rejected (attempt ${attempts}); retrying slot\n`)
        if (attempts >= 4) {
          throw new Error(`renderer ${renderer} failed the acceptance gate 4 times`)
        }
        continue
      }
      records.push({ tag, rep: rep + 1, renderer, result, gfxInfo, thermalBefore, thermalAfter })
      writeFileSync(outputPath, `${JSON.stringify(records, null, 2)}\n`)
      process.stdout.write(
        `  js=${result.js.fps.toFixed(2)} main=${result.native.mainThread.fps.toFixed(2)} ` +
          `cpu=${result.native.processCpuPercent.toFixed(1)}% ` +
          `hwui=${gfxInfo.totalFrames} jank=${gfxInfo.jankyPercent}%\n`
      )
      break
    }
  }
}

process.stdout.write(`\n=== ${tag} (median of ${reps}) ===\n`)
for (const renderer of renderers) {
  const own = records.filter((record) => record.renderer === renderer)
  const pick = (fn) => median(own.map(fn)).toFixed(2)
  process.stdout.write(
    `${renderer.padEnd(14)} jsFps=${pick((r) => r.result.js.fps)} ` +
      `jsP99=${pick((r) => r.result.js.p99Ms)}ms ` +
      `mainFps=${pick((r) => r.result.native.mainThread.fps)} ` +
      `mainP99=${pick((r) => r.result.native.mainThread.p99Ms)}ms ` +
      `cpu=${pick((r) => r.result.native.processCpuPercent)}% ` +
      `hwuiFrames=${pick((r) => r.gfxInfo.totalFrames)} ` +
      `jank=${pick((r) => r.gfxInfo.jankyPercent)}% ` +
      `pss=${(median(own.map((r) => r.result.native.memory.peakPssKb)) / 1024).toFixed(1)}MB\n`
  )
}
process.stdout.write(`saved ${records.length} runs to ${outputPath}\n`)
