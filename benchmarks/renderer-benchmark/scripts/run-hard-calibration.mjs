import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const artifacts = resolve(root, 'artifacts')
const serial = 'RZCW30KE1NB'
const session = 'renderer-hard'
const app = 'com.rendererbenchmark'
const pressureMs = Number(
  process.argv.find((argument) => argument.startsWith('--pressure='))?.split('=')[1] ??
    12
)
const renderers = ['skia-graphite', 'thor-cpu', 'thor-gpu', 'tgfx']
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
  }
}

function waitForThermalNone() {
  let sleeping = false
  while (true) {
    const state = thermal()
    if (state.status === 0 && state.skinC <= 38) {
      if (sleeping) {
        adb(['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'])
        adb(['shell', 'wm', 'dismiss-keyguard'])
      }
      return state
    }
    if (!sleeping) {
      adb(['shell', 'input', 'keyevent', 'KEYCODE_SLEEP'])
      sleeping = true
    }
    process.stdout.write(
      `cooldown status=${state.status} skin=${state.skinC.toFixed(1)}C\n`
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

mkdirSync(artifacts, { recursive: true })
const records = []

for (const renderer of renderers) {
  const thermalBefore = waitForThermalNone()
  process.stdout.write(
    `hard calibration renderer=${renderer} skin=${thermalBefore.skinC.toFixed(1)}C\n`
  )
  agent(['open', app, '--relaunch'])
  agent(['wait', 'text', 'Renderer stress benchmark', '10000'])
  agent(['press', `role=button label="${labels[renderer]}"`, '--settle'])
  agent(['press', 'role=button label="3200"', '--settle'])
  agent(['press', `role=button label="${pressureMs}ms"`, '--settle'])
  agent(['press', 'role=button label="5s"', '--settle'])
  agent(['press', 'role=button label="15s"', '--settle'])
  agent(['press', 'role=button label="20260729"', '--settle'])
  adb(['logcat', '-c'])
  adb(['shell', 'dumpsys', 'gfxinfo', app, 'reset'])
  agent(['press', 'role=button label="Start benchmark"'])
  agent(['wait', '25000'])
  agent(['wait', 'text', 'Benchmark complete', '30000'])
  const result = publishedResult(adb(['logcat', '-d']))
  const thermalAfter = thermal()
  records.push({ renderer, thermalBefore, thermalAfter, result })
  writeFileSync(
    resolve(artifacts, `hard-calibration-${pressureMs}ms.json`),
    `${JSON.stringify(records, null, 2)}\n`
  )
  process.stdout.write(
    `done renderer=${renderer} js=${result.js.fps.toFixed(2)} main=${result.native.mainThread.fps.toFixed(2)} mainP99=${result.native.mainThread.p99Ms.toFixed(1)}ms missed=${result.native.mainThread.missedFrames} cpu=${result.native.processCpuPercent.toFixed(1)}%\n`
  )
}
