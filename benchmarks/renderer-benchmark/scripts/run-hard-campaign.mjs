import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const artifacts = resolve(root, 'artifacts')
const serial = 'RZCW30KE1NB'
const session = 'renderer-hard'
const app = 'com.rendererbenchmark'
const outputPath = resolve(artifacts, 'hard-raw-runs.json')
const invalidPath = resolve(artifacts, 'hard-invalid-runs.json')
const orders = [
  ['skia-graphite', 'thor-cpu', 'tgfx', 'thor-gpu'],
  ['thor-cpu', 'thor-gpu', 'skia-graphite', 'tgfx'],
  ['thor-gpu', 'tgfx', 'thor-cpu', 'skia-graphite'],
]
const labels = {
  'skia-graphite': 'Skia Graphite',
  'thor-cpu': 'Thor CPU',
  'thor-gpu': 'Thor GPU',
  tgfx: 'Tgfx GPU',
}

function run(command, args) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function agent(args) {
  return run('agent-device', [...args, '--session', session])
}

function adb(args) {
  return run('adb', ['-s', serial, ...args])
}

function thermal() {
  const raw = adb(['shell', 'dumpsys', 'thermalservice'])
  return {
    status: Number(raw.match(/Thermal Status:\s*(\d+)/)?.[1] ?? -1),
    skinC: Number(
      raw.match(/mValue=([\d.]+).*mName=SKIN,\s*mStatus/)?.[1] ?? Number.NaN
    ),
    batteryC: Number(
      raw.match(/mValue=([\d.]+).*mName=BAT,\s*mStatus/)?.[1] ?? Number.NaN
    ),
  }
}

function thermalPasses(state) {
  return state.status === 0 && state.skinC <= 36 && state.batteryC <= 35
}

function waitForThermalGate() {
  let sleeping = false
  while (true) {
    const first = thermal()
    if (thermalPasses(first)) {
      run('sleep', ['15'])
      const second = thermal()
      if (thermalPasses(second)) {
        if (sleeping) {
          adb(['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'])
          adb(['shell', 'wm', 'dismiss-keyguard'])
        }
        return { first, second }
      }
    }
    if (!sleeping) {
      adb(['shell', 'input', 'keyevent', 'KEYCODE_SLEEP'])
      sleeping = true
    }
    process.stdout.write(
      `cooldown status=${first.status} skin=${first.skinC.toFixed(1)}C\n`
    )
    run('sleep', ['15'])
  }
}

function publishedResult(logcat) {
  const json = logcat
    .split('\n')
    .filter((line) => line.includes('RendererBenchmark'))
    .map((line) => line.slice(line.indexOf('{"schemaVersion"')))
    .filter((line) => line.startsWith('{'))
    .at(-1)
  if (!json) {
    throw new Error('No complete RendererBenchmark result found')
  }
  return JSON.parse(json)
}

function parseGfxInfo(raw) {
  const number = (pattern) => {
    const value = raw.match(pattern)?.[1]
    return value === undefined ? null : Number(value)
  }
  return {
    totalFrames: number(/Total frames rendered:\s*(\d+)/),
    jankyFrames: number(/Janky frames:\s*(\d+)/),
    jankyPercent: number(/Janky frames:\s*\d+\s*\(([\d.]+)%\)/),
    p50Ms: number(/50th percentile:\s*(\d+)ms/),
    p90Ms: number(/90th percentile:\s*(\d+)ms/),
    p95Ms: number(/95th percentile:\s*(\d+)ms/),
    p99Ms: number(/99th percentile:\s*(\d+)ms/),
  }
}

function accepted(record) {
  const { config, native } = record.result
  return (
    config.renderer === record.renderer &&
    config.objectCount === 3200 &&
    config.mainThreadPressureMs === 15 &&
    config.warmupSeconds === 5 &&
    config.durationSeconds === 15 &&
    native.device.refreshRateHz >= 59 &&
    native.device.refreshRateHz <= 61 &&
    native.device.thermalStatusStart === 0 &&
    native.device.thermalStatusEnd === 0 &&
    record.thermalBefore.first.status === 0 &&
    record.thermalBefore.second.status === 0 &&
    record.thermalAfter.status === 0 &&
    !record.backendLogLines.some((line) =>
      /FATAL EXCEPTION|SIGABRT|OutOfMemoryError|ANR in com\.rendererbenchmark/.test(
        line
      )
    )
  )
}

function save(path, records) {
  mkdirSync(artifacts, { recursive: true })
  writeFileSync(path, `${JSON.stringify(records, null, 2)}\n`)
}

const records = []
const invalidRecords = []

agent(['logs', 'clear', '--restart'])

for (let cycle = 0; cycle < orders.length; cycle += 1) {
  for (let position = 0; position < orders[cycle].length; position += 1) {
    const renderer = orders[cycle][position]
    const runIndex = cycle * 4 + position + 1
    const thermalBefore = waitForThermalGate()
    process.stdout.write(
      `hard run ${runIndex}/12 renderer=${renderer} skin=${thermalBefore.second.skinC.toFixed(1)}C\n`
    )
    agent(['open', app, '--relaunch'])
    agent(['wait', 'text', 'Renderer stress benchmark', '10000'])
    agent(['press', `role=button label="${labels[renderer]}"`, '--settle'])
    agent(['press', 'role=button label="3200"', '--settle'])
    agent(['press', 'role=button label="15ms"', '--settle'])
    agent(['press', 'role=button label="5s"', '--settle'])
    agent(['press', 'role=button label="15s"', '--settle'])
    agent(['press', 'role=button label="20260729"', '--settle'])
    adb(['logcat', '-c'])
    adb(['shell', 'dumpsys', 'gfxinfo', app, 'reset'])
    const pid = Number(adb(['shell', 'pidof', app]).trim())
    agent(['press', 'role=button label="Start benchmark"'])
    agent(['wait', '25000'])
    agent(['wait', 'text', 'Benchmark complete', '30000'])
    const logcat = adb(['logcat', '-d'])
    const record = {
      runIndex,
      cycle: cycle + 1,
      position: position + 1,
      renderer,
      pid,
      thermalBefore,
      thermalAfter: thermal(),
      result: publishedResult(logcat),
      gfxInfo: parseGfxInfo(
        adb(['shell', 'dumpsys', 'gfxinfo', app, 'framestats'])
      ),
      backendLogLines: logcat
        .split('\n')
        .filter((line) =>
          /RNSkia|Dawn|Thor|TGFX|Tgfx|OpenGL|Vulkan|RendererBenchmark|FATAL EXCEPTION|SIGABRT|OutOfMemoryError|ANR in com\.rendererbenchmark/.test(
            line
          )
        ),
    }
    if (!accepted(record)) {
      invalidRecords.push({ ...record, exclusionReason: 'acceptance gate failed' })
      save(invalidPath, invalidRecords)
      process.stdout.write(
        `invalid ${runIndex}/12 thermal=${record.result.native.device.thermalStatusStart}->${record.result.native.device.thermalStatusEnd}/${record.thermalAfter.status}; rerunning\n`
      )
      position -= 1
      continue
    }
    records.push(record)
    save(outputPath, records)
    process.stdout.write(
      `done ${runIndex}/12 main=${record.result.native.mainThread.fps.toFixed(2)} p99=${record.result.native.mainThread.p99Ms.toFixed(1)}ms missed=${record.result.native.mainThread.missedFrames} js=${record.result.js.fps.toFixed(2)} cpu=${record.result.native.processCpuPercent.toFixed(1)}%\n`
    )
  }
}

agent(['logs', 'stop'])
save(outputPath, records)
