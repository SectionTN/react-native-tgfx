#!/usr/bin/env node
// Host half of the bench: restarts the app, tails logcat for its `[bench]`
// lines, and samples CPU (/proc/<pid>/stat) and memory (dumpsys meminfo) per
// second. Writes a per-scene table when the app prints `[bench] done`.
//
//   node bench/run.mjs [--package com.tgfxskiabench]
//
// Install a RELEASE build first: benchmarking a debug build measures the
// debug overhead, not the engines.
import { execFile, spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const shotsDir = join(dirname(fileURLToPath(import.meta.url)), 'shots');
mkdirSync(shotsDir, { recursive: true });

const args = process.argv.slice(2);
function arg(name, fallback) {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] !== undefined ? args[at + 1] : fallback;
}
const PACKAGE = arg('package', 'com.tgfxskiabench');
// 'atrace' counts SF `queueBuffer - <layer>` events (Android 14+); 'latency'
// reads `dumpsys SurfaceFlinger --latency` present timestamps (Android <= 13).
const PRESENT = arg('present', 'atrace');
// Matrix selection, forwarded to the app through the launch URL (see App.tsx buildPlan).
const PLAN_URL = `bench://run?engines=${arg('engines', 'tgfx,skia,graphite')}&scenes=${arg('scenes', 'shapes,images,shader,pattern,paths,text')}&order=${arg('order', 'sequential')}&reps=${arg('reps', '1')}`;
const COMBOS = arg('engines', 'tgfx,skia,graphite').split(',').length * arg('scenes', 'shapes,images,shader,pattern,paths,text').split(',').length * Number(arg('reps', '1'));
const SETTLE_TICKS = 3;
const HZ = 100; // Linux USER_HZ

function adb(...adbArgs) {
  return new Promise(resolve => {
    execFile('adb', adbArgs, { maxBuffer: 4 * 1024 * 1024 }, (error, stdout) =>
      resolve(error ? null : (stdout ?? '').toString())
    );
  });
}

const median = values => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** combo key -> per-second samples, plus per-thread CPU keyed by thread group */
const combos = new Map();
let current = null;
function comboBucket(key) {
  if (!combos.has(key)) {
    combos.set(key, { ticks: [], cpu: [], pss: [], java: [], native: [], graphics: [], presents: [], threads: new Map() });
  }
  return combos.get(key);
}

// ---- CPU + PSS sampler -----------------------------------------------------

let lastCpu = null;
// One adb connection per sample: pid, /proc stat and PSS in a single shell round
// trip. Three connections a second was enough to wedge the host adb server
// mid-run, taking the logcat stream down with it.
async function sample() {
  if (busy) return;
  busy = true;
  const out = await adb(
    'shell',
    `cat /proc/uptime; pid=$(pidof ${PACKAGE}); echo "PID $pid"; [ -n "$pid" ] && cat /proc/$pid/stat; dumpsys meminfo ${PACKAGE} | grep -E 'TOTAL PSS|Java Heap:|Native Heap:|Graphics:'`
  );
  busy = false;
  if (!out) return;
  // Device clock, not host: adb round trips add up to 2s of skew per sample.
  const now = Number(out.match(/^(\d+\.\d+) /m)?.[1]) * 1000;
  const pid = out.match(/^PID (\d+)/m)?.[1];
  const stat = out.match(/^\d+ \(.*\) .*$/m)?.[0];
  if (pid && stat) {
    const after = stat.slice(stat.lastIndexOf(') ') + 2).trim().split(/\s+/);
    // after[0] is field 3 (state); utime is field 14, stime 15.
    const ticks = Number(after[11]) + Number(after[12]);
    if (Number.isFinite(ticks)) {
      if (lastCpu && lastCpu.pid === pid) {
        const wall = (now - lastCpu.at) / 1000;
        const pct = ((ticks - lastCpu.ticks) / HZ / wall) * 100;
        if (current && wall > 0.2 && pct >= 0) comboBucket(current).cpu.push(pct);
      }
      lastCpu = { pid, ticks, at: now };
    }
  }
  if (!current) return;
  const bucket = comboBucket(current);
  for (const [field, label] of [['pss', 'TOTAL PSS'], ['java', 'Java Heap'], ['native', 'Native Heap'], ['graphics', 'Graphics']]) {
    const kb = out.match(new RegExp(`${label}:\\s+(\\d+)`));
    if (kb) bucket[field].push(Number(kb[1]));
  }
}

// ---- per-thread CPU ---------------------------------------------------------
// Two snapshots of every thread's utime+stime, 8s apart, inside the measured
// window. Pool threads are grouped by name with the trailing index dropped.
const THREAD_WINDOW_MS = 8000;
async function threadSnapshot() {
  const out = await adb('shell', `cat /proc/uptime; pid=$(pidof ${PACKAGE}); for t in /proc/$pid/task/*; do cat $t/stat; done 2>/dev/null`);
  const at = Number(out?.match(/^(\d+\.\d+) /m)?.[1]);
  const ticks = new Map();
  for (const line of (out ?? '').split('\n')) {
    const m = line.match(/^(\d+) \((.*)\) (.*)$/);
    if (!m) continue;
    const f = m[3].trim().split(/\s+/);
    ticks.set(m[1], { name: m[2], ticks: Number(f[11]) + Number(f[12]) });
  }
  return { at, ticks };
}
async function sampleThreads(key) {
  const a = await threadSnapshot();
  await new Promise(r => setTimeout(r, THREAD_WINDOW_MS));
  const b = await threadSnapshot();
  const wall = b.at - a.at;
  if (!(wall > 1)) return;
  const groups = new Map();
  for (const [tid, t] of b.ticks) {
    const before = a.ticks.get(tid);
    if (!before) continue;
    const name = t.name === PACKAGE.slice(-15) ? 'UI' : t.name === 'mqt_v_js' ? 'JS' : t.name.replace(/[\s:_-]*[\d_]+$/, '');
    groups.set(name, (groups.get(name) ?? 0) + ((t.ticks - before.ticks) / HZ / wall) * 100);
  }
  const threads = comboBucket(key).threads;
  for (const [name, pct] of groups) {
    if (!threads.has(name)) threads.set(name, []);
    threads.get(name).push(pct);
  }
}
let busy = false;

// ---- presented frames ------------------------------------------------------
// Thread FPS says the threads are healthy; only SurfaceFlinger knows what the
// canvas actually put on screen. atrace `queueBuffer - <layer>` events count
// buffers the canvas queued. Only the app's own SurfaceView layer counts:
// with GPU composition on, FramebufferSurface queues once per frame too, and
// the extra events overflow the default ring buffer inside 8s (hence -b).
const TRACE_SECONDS = 8;
let tracing = false;
async function latencyFps() {
  const list = await adb('shell', 'dumpsys', 'SurfaceFlinger', '--list');
  const layer = list?.split('\n').find(l => l.startsWith(`SurfaceView[${PACKAGE}/`) && l.includes('(BLAST)'));
  if (!layer) return null;
  const out = await adb('shell', 'dumpsys', 'SurfaceFlinger', '--latency', `'${layer.trim()}'`);
  const times = [...new Set((out ?? '').split('\n').slice(1).map(l => Number(l.trim().split(/\s+/)[1])).filter(t => t > 0 && t < 9e18))].sort((a, b) => a - b);
  if (times.length < 2) return null;
  return (times.length - 1) / ((times.at(-1) - times[0]) / 1e9);
}
async function samplePresentedLatency(key) {
  const samples = [];
  for (let i = 0; i < 3; i++) {
    const fps = await latencyFps();
    if (fps != null) samples.push(fps);
    await new Promise(r => setTimeout(r, 2500));
  }
  if (samples.length === 0) return;
  comboBucket(key).presents.push(median(samples));
  console.log(`[bench] ${key} present=${median(samples).toFixed(1)}fps (latency x${samples.length})`);
}
function samplePresented(key) {
  if (PRESENT === 'latency') return void samplePresentedLatency(key);
  if (tracing) return;
  tracing = true;
  execFile(
    'adb',
    ['shell', `atrace -t ${TRACE_SECONDS} -b 8192 gfx 2>/dev/null | grep 'queueBuffer - SurfaceView\\[${PACKAGE}' | wc -l`],
    { maxBuffer: 16 * 1024 * 1024 },
    (error, stdout) => {
      tracing = false;
      const count = Number((stdout ?? '').trim());
      if (!error && Number.isFinite(count)) {
        comboBucket(key).presents.push(count / TRACE_SECONDS);
        console.log(`[bench] ${key} present=${(count / TRACE_SECONDS).toFixed(1)}fps`);
      }
    }
  );
}

// ---- logcat ----------------------------------------------------------------

function finish(reason) {
  clearInterval(timer);
  clearInterval(logcatWatchdog);
  const dead = logcat;
  logcat = null;
  dead?.kill();
  const rows = [];
  for (const [key, bucket] of combos) {
    const measured = bucket.ticks.slice(SETTLE_TICKS);
    if (measured.length === 0) continue;
    rows.push({
      key,
      present: bucket.presents.length ? median(bucket.presents) : null,
      js: median(measured.map(t => t.js)),
      ui: median(measured.map(t => t.ui)),
      cpu: median(bucket.cpu),
      pss: median(bucket.pss) / 1024,
      java: median(bucket.java) / 1024,
      native: median(bucket.native) / 1024,
      graphics: median(bucket.graphics) / 1024,
      threads: new Map([...bucket.threads].map(([name, pcts]) => [name, median(pcts)])),
      n: measured.length,
    });
  }
  const lines = [
    `# tgfx vs skia bench (${reason})`,
    '',
    '| engine · scene | Present FPS | UI FPS | JS FPS | CPU % (1 core = 100) | PSS MB | ticks |',
    '|---|---|---|---|---|---|---|',
    ...rows.map(r =>
      `| ${r.key} | ${r.present == null ? '?' : r.present.toFixed(1)} | ${r.ui.toFixed(0)} | ${r.js.toFixed(0)} | ${r.cpu.toFixed(0)} | ${r.pss.toFixed(1)} | ${r.n} |`
    ),
    '',
    '## Where the CPU and memory go',
    '',
    '| engine · scene | UI thread % | JS thread % | busiest other threads % | Graphics MB | Native MB | Java MB |',
    '|---|---|---|---|---|---|---|',
    ...rows.map(r => {
      const pct = name => (r.threads.get(name) ?? 0).toFixed(0);
      const others = [...r.threads]
        .filter(([name, p]) => name !== 'UI' && name !== 'JS' && p >= 1)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name, p]) => `${name} ${p.toFixed(0)}`)
        .join(', ');
      return `| ${r.key} | ${pct('UI')} | ${pct('JS')} | ${others} | ${r.graphics.toFixed(1)} | ${r.native.toFixed(1)} | ${r.java.toFixed(1)} |`;
    }),
  ];
  const report = lines.join('\n');
  console.log(`\n${report}\n`);
  const out = join(dirname(fileURLToPath(import.meta.url)), `results-${Date.now()}.md`);
  writeFileSync(out, report + '\n');
  console.log(`[bench] wrote ${out}`);
  process.exit(rows.length > 0 ? 0 : 2);
}

// adb's logcat stream can die mid-run (Android 15 phones drop it after a few
// minutes); the app keeps going, the host just stops hearing it. Watch for
// silence and respawn from the last timestamp seen, dropping the one line
// `-T` re-delivers.
const LOGCAT_SILENCE_MS = 8000;
let logcat = null;
let pending = '';
let lastTimestamp = '1';
let lastLine = '';
let lastHeard = Date.now();
function startLogcat() {
  logcat = spawn('adb', ['logcat', '-T', lastTimestamp, '-s', 'ReactNativeJS:I']);
  pending = '';
  logcat.stdout.on('data', onLogcat);
  logcat.on('exit', () => {
    if (logcat) setTimeout(startLogcat, 500);
  });
}
function onLogcat(chunk) {
  lastHeard = Date.now();
  // BENCH_RAW_LOG=<file> keeps every byte logcat delivered, for debugging the runner itself.
  if (process.env.BENCH_RAW_LOG) appendFileSync(process.env.BENCH_RAW_LOG, chunk);
  pending += chunk.toString();
  const lines = pending.split('\n');
  pending = lines.pop() ?? '';
  for (const line of lines) {
    if (line === lastLine) continue;
    lastLine = line;
    const stamp = line.match(/^(\d\d-\d\d \d\d:\d\d:\d\d\.\d+)/);
    if (stamp) lastTimestamp = stamp[1];
    const start = line.match(/\[bench\] start engine=(\w+) scene=(\w+)/);
    if (start) {
      current = `${start[1]} · ${start[2]}`;
      console.log(`[bench] >> ${current}`);
      const key = current;
      setTimeout(() => samplePresented(key), 6000);
      setTimeout(() => sampleThreads(key), 7000);
      continue;
    }
    // The app freezes t=0 for 1.5s and prints this; a screencap inside the
    // window gives pixel-comparable parity stills across the two engines.
    const pose = line.match(/\[bench\] pose engine=(\w+) scene=(\w+)/);
    if (pose) {
      const shot = join(shotsDir, `${pose[1]}-${pose[2]}.png`);
      execFile('bash', ['-c', `adb exec-out screencap -p > '${shot}'`], () => {});
      continue;
    }
    const tick = line.match(/\[bench\] tick engine=(\w+) scene=(\w+) js=(\d+) ui=(\d+)/);
    if (tick) {
      const key = `${tick[1]} · ${tick[2]}`;
      const bucket = comboBucket(key);
      bucket.ticks.push({ js: Number(tick[3]), ui: Number(tick[4]) });
      process.stdout.write(`[bench] ${key} js=${tick[3]} ui=${tick[4]}\n`);
      continue;
    }
    if (line.includes('[bench] done')) finish('complete');
  }
}
startLogcat();
const logcatWatchdog = setInterval(() => {
  if (Date.now() - lastHeard > LOGCAT_SILENCE_MS && logcat) {
    console.log(`[bench] logcat silent ${LOGCAT_SILENCE_MS / 1000}s, reconnecting and respawning from ${lastTimestamp}`);
    const dead = logcat;
    logcat = null;
    dead.kill();
    lastHeard = Date.now();
    busy = false;
    // The stream usually dies because the host adb server wedged; a reconnect
    // re-establishes the transport before the new logcat asks for it.
    adb('reconnect').then(startLogcat);
  }
}, 2000);

await adb('shell', 'am', 'force-stop', PACKAGE);
await adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-n', `${PACKAGE}/.MainActivity`, '-d', `'${PLAN_URL}'`);
const timer = setInterval(sample, 1000);
// combos x 28s + startup, with slack.
setTimeout(() => finish('timeout'), (COMBOS * 28 + 60) * 1000);
