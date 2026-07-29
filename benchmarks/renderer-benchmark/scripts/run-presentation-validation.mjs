import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const artifacts = resolve(root, 'artifacts')
const serial = 'RZCW30KE1NB'
const session = 'renderer-benchmark'
const app = 'com.rendererbenchmark'
const allRenderers = ['skia-graphite', 'thor-cpu', 'thor-gpu', 'tgfx']
const requestedRenderer = process.argv
  .find((argument) => argument.startsWith('--renderer='))
  ?.split('=')[1]
const renderers = requestedRenderer ? [requestedRenderer] : allRenderers
const labels = {
  'skia-graphite': 'Skia Graphite',
  'thor-cpu': 'Thor CPU',
  'thor-gpu': 'Thor GPU',
  tgfx: 'Tgfx GPU',
}

function run(command, args) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
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

function thermal() {
  const raw = adb(['shell', 'dumpsys', 'thermalservice'])
  return {
    status: Number(raw.match(/Thermal Status:\s*(\d+)/)?.[1] ?? -1),
    skinC: Number(
      raw.match(/mValue=([\d.]+).*mName=SKIN,\s*mStatus/)?.[1] ?? Number.NaN
    ),
  }
}

function waitForCoolDevice() {
  let sleeping = false
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const state = thermal()
    if (state.status === 0 && state.skinC <= 36.0) {
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
  throw new Error('Thermal gate was not reached')
}

mkdirSync(artifacts, { recursive: true })
const validationPath = resolve(artifacts, 'presentation-validation.json')
let records = []
if (requestedRenderer) {
  try {
    records = JSON.parse(readFileSync(validationPath, 'utf8')).filter(
      (record) => record.renderer !== requestedRenderer
    )
  } catch {}
}

for (const renderer of renderers) {
  const thermalBefore = waitForCoolDevice()
  process.stdout.write(
    `presentation renderer=${renderer} skin=${thermalBefore.skinC.toFixed(1)}C\n`
  )
  agent(['open', app, '--relaunch'])
  agent(['wait', 'text', 'Renderer stress benchmark', '10000'])
  agent(['press', `role=button label="${labels[renderer]}"`, '--settle'])
  agent(['press', 'role=button label="400"', '--settle'])
  agent(['press', 'role=button label="5s"', '--settle'])
  agent(['press', 'role=button label="15s"', '--settle'])
  agent(['press', 'role=button label="20260729"', '--settle'])
  adb([
    'shell',
    'dumpsys',
    'SurfaceFlinger',
    '--timestats',
    '-disable',
    '-clear',
    '-enable',
  ])
  agent(['press', 'role=button label="Start benchmark"'])
  agent(['wait', '22000'])
  agent(['wait', 'text', 'Benchmark complete', '5000'])
  const timeStats = adb([
    'shell',
    'dumpsys',
    'SurfaceFlinger',
    '--timestats',
    '-disable',
    '-dump',
    '-maxlayers',
    '200',
  ])
  const thermalAfter = thermal()
  const file = resolve(artifacts, `surfaceflinger-${renderer}.txt`)
  writeFileSync(file, timeStats)
  records.push({ renderer, thermalBefore, thermalAfter, file })
  process.stdout.write(
    `done renderer=${renderer} thermal=${thermalAfter.status} skin=${thermalAfter.skinC.toFixed(1)}C\n`
  )
}

writeFileSync(
  validationPath,
  `${JSON.stringify(records, null, 2)}\n`
)
