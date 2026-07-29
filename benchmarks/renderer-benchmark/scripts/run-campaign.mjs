import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const artifacts = resolve(root, 'artifacts')
const serial = 'RZCW30KE1NB'
const session = 'renderer-benchmark'
const app = 'com.rendererbenchmark'
const outputPath = resolve(artifacts, 'raw-runs.json')
const invalidOutputPath = resolve(artifacts, 'invalid-runs.json')
const orders = [
  ['skia-graphite', 'thor-cpu', 'tgfx', 'thor-gpu'],
  ['thor-cpu', 'thor-gpu', 'skia-graphite', 'tgfx'],
  ['thor-gpu', 'tgfx', 'thor-cpu', 'skia-graphite'],
  ['tgfx', 'skia-graphite', 'thor-gpu', 'thor-cpu'],
  ['thor-cpu', 'thor-gpu', 'skia-graphite', 'tgfx'],
]
const labels = {
  'skia-graphite': 'Skia Graphite',
  'thor-cpu': 'Thor CPU',
  'thor-gpu': 'Thor GPU',
  tgfx: 'Tgfx GPU',
}

function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    })
  } catch (error) {
    const stdout = error.stdout?.toString() ?? ''
    const stderr = error.stderr?.toString() ?? ''
    throw new Error(`${command} ${args.join(' ')}\n${stdout}\n${stderr}`)
  }
}

function agent(args) {
  return run('agent-device', [
    ...args,
    '--session',
    session,
    '--platform',
    'android',
    '--serial',
    serial,
  ])
}

function adb(args) {
  return run('adb', ['-s', serial, ...args])
}

function thermalSnapshot() {
  const raw = adb(['shell', 'dumpsys', 'thermalservice'])
  const status = Number(raw.match(/Thermal Status:\s*(\d+)/)?.[1] ?? -1)
  const skinC = Number(
    raw.match(/mValue=([\d.]+).*mName=SKIN,\s*mStatus/)?.[1] ?? Number.NaN
  )
  const apC = Number(
    raw.match(/mValue=([\d.]+).*mName=AP,\s*mStatus/)?.[1] ?? Number.NaN
  )
  const batteryC = Number(
    raw.match(/mValue=([\d.]+).*mName=BAT,\s*mStatus/)?.[1] ?? Number.NaN
  )
  return { status, skinC, apC, batteryC }
}

function thermalPasses(thermal) {
  return (
    thermal.status === 0 &&
    thermal.skinC <= 38.0 &&
    thermal.batteryC <= 35.0
  )
}

function waitForThermalGate() {
  let screenSleeping = false
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const first = thermalSnapshot()
    if (thermalPasses(first)) {
      run('sleep', ['15'])
      const second = thermalSnapshot()
      if (thermalPasses(second)) {
        if (screenSleeping) {
          adb(['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'])
          adb(['shell', 'wm', 'dismiss-keyguard'])
        }
        return { first, second }
      }
    }
    if (!screenSleeping) {
      adb(['shell', 'input', 'keyevent', 'KEYCODE_SLEEP'])
      screenSleeping = true
    }
    process.stdout.write(
      `cooldown status=${first.status} skin=${first.skinC.toFixed(1)}C battery=${first.batteryC.toFixed(1)}C\n`
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
    throw new Error(`No RendererBenchmark result in logcat\n${logcat}`)
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
    jankyFrames: number(/Janky frames:\s*(\d+)/),
    jankyPercent: number(/Janky frames:\s*\d+\s*\(([\d.]+)%\)/),
    p50Ms: number(/50th percentile:\s*(\d+)ms/),
    p90Ms: number(/90th percentile:\s*(\d+)ms/),
    p95Ms: number(/95th percentile:\s*(\d+)ms/),
    p99Ms: number(/99th percentile:\s*(\d+)ms/),
    missedVsync: number(/Number Missed Vsync:\s*(\d+)/),
    highInputLatency: number(/Number High input latency:\s*(\d+)/),
    slowUiThread: number(/Number Slow UI thread:\s*(\d+)/),
    slowBitmapUploads: number(/Number Slow bitmap uploads:\s*(\d+)/),
    slowDraw: number(/Number Slow issue draw commands:\s*(\d+)/),
  }
}

function save(records) {
  mkdirSync(artifacts, { recursive: true })
  writeFileSync(outputPath, `${JSON.stringify(records, null, 2)}\n`)
}

const records = []
const invalidRecords = []

function recordIsValid(record) {
  const { config, native } = record.result
  return (
    config.renderer === (record.plannedRenderer ?? config.renderer) &&
    config.objectCount === 400 &&
    config.warmupSeconds === 5 &&
    config.durationSeconds === 15 &&
    config.seed === 20260729 &&
    native.wallTimeMs >= 14900 &&
    native.wallTimeMs <= 15300 &&
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

function saveInvalid(recordsToSave) {
  mkdirSync(artifacts, { recursive: true })
  writeFileSync(invalidOutputPath, `${JSON.stringify(recordsToSave, null, 2)}\n`)
}

if (process.argv.includes('--resume')) {
  try {
    for (const record of JSON.parse(readFileSync(outputPath, 'utf8'))) {
      if (recordIsValid(record)) {
        records.push(record)
      } else {
        invalidRecords.push({ ...record, exclusionReason: 'acceptance gate failed' })
      }
    }
    save(records)
    saveInvalid(invalidRecords)
  } catch {}
}

agent(['logs', 'clear', '--restart'])

for (let cycle = 0; cycle < orders.length; cycle += 1) {
  for (let position = 0; position < orders[cycle].length; position += 1) {
    const renderer = orders[cycle][position]
    const runIndex = cycle * orders[cycle].length + position + 1
    if (records.some((record) => record.runIndex === runIndex)) {
      continue
    }
    const thermalBefore = waitForThermalGate()
    process.stdout.write(
      `run ${runIndex}/20 cycle=${cycle + 1} renderer=${renderer} skin=${thermalBefore.second.skinC.toFixed(1)}C\n`
    )
    agent(['open', app, '--relaunch'])
    agent(['wait', 'text', 'Renderer stress benchmark', '10000'])
    agent(['press', `role=button label="${labels[renderer]}"`, '--settle'])
    agent(['press', 'role=button label="400"', '--settle'])
    agent(['press', 'role=button label="5s"', '--settle'])
    agent(['press', 'role=button label="15s"', '--settle'])
    agent(['press', 'role=button label="20260729"', '--settle'])
    adb(['logcat', '-c'])
    adb(['shell', 'log', '-t', 'BenchmarkCampaign', `run-${runIndex}-${renderer}`])
    adb(['shell', 'dumpsys', 'gfxinfo', app, 'reset'])
    const pid = Number(adb(['shell', 'pidof', app]).trim())
    const startedAt = new Date().toISOString()
    agent(['press', 'role=button label="Start benchmark"'])
    agent(['wait', '22000'])
    agent(['wait', 'text', 'Benchmark complete', '5000'])
    const completedAt = new Date().toISOString()
    const logcat = adb(['logcat', '-d'])
    const result = parsePublishedResult(logcat)
    const gfxInfoRaw = adb(['shell', 'dumpsys', 'gfxinfo', app, 'framestats'])
    const thermalAfter = thermalSnapshot()
    const record = {
      runIndex,
      cycle: cycle + 1,
      position: position + 1,
      plannedRenderer: renderer,
      pid,
      startedAt,
      completedAt,
      thermalBefore,
      thermalAfter,
      result,
      gfxInfo: parseGfxInfo(gfxInfoRaw),
      backendLogLines: logcat
        .split('\n')
        .filter((line) =>
          /RNSkia|Dawn|Thor|TGFX|Tgfx|OpenGL|Vulkan|RendererBenchmark|FATAL EXCEPTION|SIGABRT|OutOfMemoryError|ANR in com\.rendererbenchmark/.test(
            line
          )
        ),
    }
    if (!recordIsValid(record)) {
      invalidRecords.push({ ...record, exclusionReason: 'acceptance gate failed' })
      saveInvalid(invalidRecords)
      process.stdout.write(
        `invalid ${runIndex}/20 thermal=${result.native.device.thermalStatusStart}->${result.native.device.thermalStatusEnd}/${thermalAfter.status}; rerunning slot\n`
      )
      position -= 1
      continue
    }
    records.push(record)
    records.sort((first, second) => first.runIndex - second.runIndex)
    save(records)
    process.stdout.write(
      `done ${runIndex}/20 js=${result.js.fps.toFixed(2)} main=${result.native.mainThread.fps.toFixed(2)} cpu=${result.native.processCpuPercent.toFixed(1)} pss=${(result.native.memory.peakPssKb / 1024).toFixed(1)}MB thermal=${thermalAfter.status}\n`
    )
  }
}

agent(['logs', 'stop'])
save(records)
process.stdout.write(`saved ${records.length} runs to ${outputPath}\n`)
