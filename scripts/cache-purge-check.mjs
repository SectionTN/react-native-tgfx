#!/usr/bin/env node
// The host half of apps/example/src/cachePurgeAdb.harness.tsx: while the
// device fills the tgfx caches, purges them, and holds either side, this
// samples `adb shell dumpsys meminfo` and asserts that the purge dropped the
// process's TOTAL PSS. All measurement is OS accounting — the JS-visible
// numbers are caches.harness.tsx's business, this proves the memory is really
// given back.
//
//   node scripts/cache-purge-check.mjs [--package com.tgfxexample]
//                                      [--drop-mb 15] [--interval-ms 1000]
//
// Exit codes: 0 the purge dropped the memory, 1 it did not, 2 the run broke.
import { execFile, spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
function arg(name, fallback) {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] !== undefined ? args[at + 1] : fallback;
}

const PACKAGE = arg('package', 'com.tgfxexample');
const DROP_MB = Number(arg('drop-mb', '15'));
const INTERVAL_MS = Number(arg('interval-ms', '1000'));

const exampleDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'example');

function adb(...adbArgs) {
  return new Promise(resolve => {
    execFile('adb', adbArgs, { maxBuffer: 4 * 1024 * 1024 }, (error, stdout) =>
      resolve(error ? null : stdout)
    );
  });
}

function parseMeminfo(text) {
  const grab = label => {
    const match = text.match(new RegExp(`${label}:\\s+(\\d+)`));
    return match ? Number(match[1]) : null;
  };
  const total = grab('TOTAL PSS');
  if (total === null) return null;
  return { total, native: grab('Native Heap'), graphics: grab('Graphics') };
}

const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const mb = kb => (kb / 1024).toFixed(1);

const samples = [];
let filledAt = null;
let purgedAt = null;
let sampling = false;
async function sample() {
  if (sampling) return;
  sampling = true;
  const out = await adb('shell', 'dumpsys', 'meminfo', PACKAGE);
  sampling = false;
  const parsed = out && parseMeminfo(out);
  if (!parsed) return;
  samples.push({ at: Date.now(), ...parsed });
  console.log(
    `[cache-check] #${samples.length} total ${mb(parsed.total)}MB ` +
      `native ${mb(parsed.native ?? 0)}MB graphics ${mb(parsed.graphics ?? 0)}MB`
  );
}

function verdict() {
  if (filledAt === null || purgedAt === null) {
    console.error('[cache-check] phase markers never arrived in logcat — no verdict');
    return 2;
  }
  // Settle margins around each marker, so the medians are plateau readings.
  const pre = samples.filter(s => s.at > filledAt + 2000 && s.at < purgedAt);
  const post = samples.filter(s => s.at > purgedAt + 2000);
  if (pre.length < 3 || post.length < 3) {
    console.error(`[cache-check] too few samples (${pre.length} before, ${post.length} after)`);
    return 2;
  }
  const drop = key => median(pre.map(s => s[key] ?? 0)) - median(post.map(s => s[key] ?? 0));
  const totalDrop = drop('total');
  console.log(`[cache-check] purge drop (median of ${pre.length} filled vs ${post.length} purged samples):`);
  console.log(`[cache-check]   TOTAL PSS   ${mb(totalDrop)}MB  (required ${DROP_MB}MB)`);
  console.log(`[cache-check]   Native Heap ${mb(drop('native'))}MB`);
  console.log(`[cache-check]   Graphics    ${mb(drop('graphics'))}MB`);
  if (totalDrop < DROP_MB * 1024) {
    console.error(`::error::purgeCaches() only gave back ${mb(totalDrop)}MB of TOTAL PSS`);
    return 1;
  }
  console.log('[cache-check] OK — the purge dropped the memory');
  return 0;
}

// A leftover instance would sit in the samples with its own memory.
await adb('shell', 'am', 'force-stop', PACKAGE);

// Markers come through logcat: console.log lands under ReactNativeJS.
const logcat = spawn('adb', ['logcat', '-T', '1', '-s', 'ReactNativeJS:I']);
logcat.stdout.on('data', chunk => {
  const text = chunk.toString();
  if (filledAt === null && text.includes('[cache-adb] filled')) {
    filledAt = Date.now();
    console.log('[cache-check] filled marker seen');
  }
  if (purgedAt === null && text.includes('[cache-adb] purged')) {
    purgedAt = Date.now();
    console.log('[cache-check] purged marker seen');
  }
});

const child = spawn(
  'bun',
  // Positional before the override: yargs array flags swallow following positionals.
  ['harness', 'src/cachePurgeAdb.harness.tsx', '--testPathIgnorePatterns=$^'],
  { cwd: exampleDir, stdio: 'inherit' }
);
const timer = setInterval(sample, INTERVAL_MS);
child.on('exit', code => {
  clearInterval(timer);
  logcat.kill();
  if (code !== 0) {
    console.error(`[cache-check] harness exited with ${code} — no verdict`);
    process.exit(2);
  }
  process.exit(verdict());
});
