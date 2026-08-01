// Captures the frozen (phase 0) frame of each renderer as a PNG, so rendering
// can be compared numerically: tgfx before vs after a change (must be pixel
// identical) and tgfx vs another renderer (anti-aliasing differs, geometry
// must not).
//
// Usage: node scripts/pixel-gate.mjs --tag=it1 [--renderers=tgfx,skia-graphite]
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const shots = resolve(root, 'artifacts', 'frames')
const serial = process.env.ANDROID_SERIAL ?? 'RZCW30KE1NB'
const session = 'renderer-benchmark'
const app = 'com.rendererbenchmark'
const labels = {
  'skia-graphite': 'Skia Graphite',
  'thor-cpu': 'Thor CPU',
  'thor-gpu': 'Thor GPU',
  tgfx: 'Tgfx GPU',
}

const arg = (name, fallback) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback
const tag = arg('tag', 'frame')
const renderers = arg('renderers', 'tgfx').split(',')
const objects = arg('objects', '400')

const agent = (args) =>
  execFileSync(
    'agent-device',
    [...args, '--session', session, '--platform', 'android', '--serial', serial],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
  )
const adb = (args) =>
  execFileSync('adb', ['-s', serial, ...args], { encoding: 'utf8' })

mkdirSync(shots, { recursive: true })
adb(['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'])
adb(['shell', 'wm', 'dismiss-keyguard'])

for (const renderer of renderers) {
  agent(['open', app, '--relaunch'])
  agent(['wait', 'text', 'Renderer stress benchmark', '15000'])
  agent(['press', `role=button label="${labels[renderer]}"`, '--settle'])
  agent(['press', `role=button label="${objects}"`, '--settle'])
  agent(['press', 'role=button label="20260729"', '--settle'])
  // The freeze button sits below the fold on the config screen.
  agent(['scroll', 'bottom'])
  agent(['press', 'role=button label="Freeze frame"', '--settle'])
  agent(['wait', '2500'])
  const png = execFileSync('adb', ['-s', serial, 'exec-out', 'screencap', '-p'], {
    maxBuffer: 64 * 1024 * 1024,
    encoding: 'buffer',
  })
  const file = resolve(shots, `${renderer}-${tag}.png`)
  writeFileSync(file, png)
  process.stdout.write(`captured ${file} (${png.length} bytes)\n`)
}
