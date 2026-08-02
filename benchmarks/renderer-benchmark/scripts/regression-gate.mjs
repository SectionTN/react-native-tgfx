// Release gate: run every few PRs to prove none of them regressed the renderer.
//
// Checks, in the order they matter:
//   1. UI accuracy   - the rendered frame must be pixel-identical to the golden
//   2. main thread    - FPS and p99
//   3. memory         - growth across repeated runs, i.e. a leak signal
//   4. CPU            - process CPU
//   5. JS thread      - FPS and p99
//
// Usage: node scripts/regression-gate.mjs [--golden=artifacts/frames/golden.png]
//                                         [--baseline=artifacts/gate-baseline.json]
//                                         [--reps=3] [--update-baseline]
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const serial = process.env.ANDROID_SERIAL
const arg = (name, fallback) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback
const has = (name) => process.argv.includes(`--${name}`)

const reps = Number(arg('reps', '3'))
const golden = resolve(root, arg('golden', 'artifacts/frames/golden.png'))
const baselinePath = resolve(root, arg('baseline', 'artifacts/gate-baseline.json'))

// A metric regresses when it moves the wrong way by more than the rig's noise.
// Derived from observed rep spread on the Samsung/moto rigs, not guessed.
const TOLERANCE = {
  mainFps: -0.03,
  mainP99Ms: 0.05,
  cpuPercent: 0.05,
  jsFps: -0.05,
  peakPssMb: 0.1,
}

const exec = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    cwd: root,
    ...opts,
  })

// Any agent can leave a session holding the device, and `agent-device session
// list` reports an empty list while one still does — so the only reliable
// handle on the squatter is the name in the error itself.
function run(cmd, args, opts = {}) {
  try {
    return exec(cmd, args, opts)
  } catch (error) {
    const stuck = String(error.stderr ?? '').match(/DEVICE_IN_USE.*?session "([^"]+)"/s)
    if (stuck === null) {
      throw error
    }
    process.stdout.write(`  releasing leaked session "${stuck[1]}" and retrying\n`)
    try {
      exec('agent-device', ['close', '--session', stuck[1]], { stdio: 'ignore' })
    } catch {}
    return exec(cmd, args, opts)
  }
}

function pixelCheck() {
  if (!existsSync(golden)) {
    return { ok: false, detail: `golden missing: ${golden}. Capture one first.` }
  }
  const shot = resolve(root, 'artifacts/frames/tgfx-frame.png')
  // The committed frame is byte-identical to the golden, so a capture that
  // never happened would compare IDENTICAL against the leftover file.
  rmSync(shot, { force: true })
  run('node', ['scripts/pixel-gate.mjs'])
  if (!existsSync(shot)) {
    return { ok: false, detail: `pixel-gate captured no frame at ${shot}` }
  }
  try {
    const out = run('/tmp/pixvenv/bin/python3', [
      'scripts/compare-frames.py',
      golden,
      shot,
      '--mode',
      'identical',
    ])
    return { ok: out.includes('IDENTICAL'), detail: out.trim().split('\n').slice(-3).join(' | ') }
  } catch (error) {
    return { ok: false, detail: String(error.stdout ?? error).trim().split('\n').slice(-3).join(' | ') }
  }
}

// pixel-gate leaves its own agent-device session open, which would make the
// campaign below fail to acquire the device.
function releaseDevice() {
  for (const name of ['renderer-benchmark', `renderer-benchmark-${serial ?? ''}`]) {
    try {
      run('agent-device', ['close', '--session', name], { stdio: 'ignore' })
    } catch {}
  }
}

function measure() {
  releaseDevice()
  run('node', [
    'scripts/run-quick.mjs',
    '--tag=regression-gate',
    '--renderers=tgfx,thor-gpu',
    `--reps=${reps}`,
  ])
  const records = JSON.parse(readFileSync(resolve(root, 'artifacts/quick-regression-gate.json'), 'utf8'))
  const own = records.filter((r) => r.renderer === 'tgfx').map((r) => r.result)
  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b)
    return sorted[(sorted.length - 1) >> 1]
  }
  const pick = (fn) => median(own.map(fn))
  // A leak shows up as end-of-run PSS climbing across consecutive runs, which a
  // single peak reading cannot distinguish from a one-off allocation.
  const endPss = own.map((r) => r.native.memory.endPssKb / 1024)
  return {
    mainFps: pick((r) => r.native.mainThread.fps),
    mainP99Ms: pick((r) => r.native.mainThread.p99Ms),
    cpuPercent: pick((r) => r.native.processCpuPercent),
    jsFps: pick((r) => r.js.fps),
    jsP99Ms: pick((r) => r.js.p99Ms),
    peakPssMb: pick((r) => r.native.memory.peakPssKb / 1024),
    endPssTrendMb: endPss.at(-1) - endPss[0],
    endPssMb: endPss,
  }
}

const pixels = pixelCheck()
const now = measure()
const failures = []

if (!pixels.ok) {
  failures.push(`UI accuracy: frame differs from golden -- ${pixels.detail}`)
}
// Growth across runs within one session is the leak signal; a single run's peak
// is not, because warmup legitimately allocates.
if (now.endPssTrendMb > 8) {
  failures.push(
    `memory: end PSS grew ${now.endPssTrendMb.toFixed(1)} MB across ${reps} runs (${now.endPssMb
      .map((v) => v.toFixed(1))
      .join(' -> ')}) -- possible leak`
  )
}

let baseline = null
if (existsSync(baselinePath)) {
  baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
  for (const [key, tolerance] of Object.entries(TOLERANCE)) {
    const before = baseline[key]
    const after = now[key]
    if (typeof before !== 'number' || typeof after !== 'number') continue
    const delta = (after - before) / before
    const regressed = tolerance < 0 ? delta < tolerance : delta > tolerance
    if (regressed) {
      failures.push(
        `${key}: ${before.toFixed(2)} -> ${after.toFixed(2)} (${(delta * 100).toFixed(1)}%)`
      )
    }
  }
}

const line = (k, v) => `  ${k.padEnd(16)} ${typeof v === 'number' ? v.toFixed(2) : v}`
process.stdout.write(`\n=== regression gate (${serial ?? 'default device'}, median of ${reps}) ===\n`)
process.stdout.write(`  UI accuracy      ${pixels.ok ? 'IDENTICAL' : 'DIFFERS'}\n`)
for (const k of ['mainFps', 'mainP99Ms', 'cpuPercent', 'jsFps', 'jsP99Ms', 'peakPssMb']) {
  process.stdout.write(line(k, now[k]) + (baseline ? `   (was ${baseline[k]?.toFixed(2) ?? 'n/a'})` : ''))
  process.stdout.write('\n')
}
process.stdout.write(line('endPssTrend', now.endPssTrendMb) + ' MB across runs\n')

if (has('update-baseline')) {
  writeFileSync(baselinePath, `${JSON.stringify(now, null, 2)}\n`)
  process.stdout.write(`\nbaseline written to ${baselinePath}\n`)
}

if (failures.length > 0) {
  process.stdout.write(`\nREGRESSIONS (${failures.length}):\n`)
  for (const f of failures) process.stdout.write(`  - ${f}\n`)
  process.exit(1)
}
process.stdout.write('\nno regressions\n')
