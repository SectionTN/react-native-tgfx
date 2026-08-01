// Captures a Perfetto trace over one benchmark run, so main-thread time can be
// attributed to real slices instead of inferred from FPS.
//
// Usage: node scripts/trace.mjs --tag=it0 --renderer=tgfx
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const artifacts = resolve(root, 'artifacts', 'traces')
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
const tag = arg('tag', 'trace')
const renderer = arg('renderer', 'tgfx')
const objects = arg('objects', '400')
const seconds = Number(arg('seconds', '12'))

const agent = (args) =>
  execFileSync(
    'agent-device',
    [...args, '--session', session, '--platform', 'android', '--serial', serial],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
  )
const adb = (args) =>
  execFileSync('adb', ['-s', serial, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })

mkdirSync(artifacts, { recursive: true })
adb(['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'])
adb(['shell', 'wm', 'dismiss-keyguard'])
agent(['open', app, '--relaunch'])
agent(['wait', 'text', 'Renderer stress benchmark', '15000'])
agent(['press', `role=button label="${labels[renderer]}"`, '--settle'])
agent(['press', `role=button label="${objects}"`, '--settle'])
agent(['press', 'role=button label="5s"', '--settle'])
agent(['press', 'role=button label="15s"', '--settle'])
agent(['press', 'role=button label="20260729"', '--settle'])
agent(['press', 'role=button label="Start benchmark"'])

// Skip the 5s warmup, then trace inside the measured window.
await new Promise((r) => setTimeout(r, 6500))
const devicePath = `/data/misc/perfetto-traces/${renderer}-${tag}.pftrace`
const capture = spawn(
  'adb',
  [
    '-s', serial, 'shell', 'perfetto', '-o', devicePath,
    '-t', `${seconds}s`, '-b', '64mb', '-a', app,
    'sched', 'freq', 'gfx', 'view', 'wm', 'am', 'binder_driver', 'app',
  ],
  { stdio: 'inherit' }
)
await new Promise((r) => capture.on('exit', r))
agent(['wait', 'text', 'Benchmark complete', '15000'])

const localPath = resolve(artifacts, `${renderer}-${tag}.pftrace`)
adb(['pull', devicePath, localPath])
adb(['shell', 'rm', devicePath])
process.stdout.write(`trace saved to ${localPath}\n`)
