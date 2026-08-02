import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// Script alphabet: w = wakeUp, t = idle tick, T = tick during an in-flight frame.
const PROGRAMS = [
  // Idle pauses: three grace ticks, then the link is paused.
  'ttttt',
  // A wake after the pause draws again on the next tick.
  'ttttwt',
  // #36: a wake during a long frame must survive it, and no skipped tick counts as idle.
  'twTTTTTTt',
  // The same, with no wake at all: an in-flight frame is not idleness either.
  'tTTTTTTTTt',
] as const

const PROGRAM = `#include <cstdio>
#include <string>
#include "IdleGate.hpp"

int main(int argc, char** argv) {
  for (int i = 1; i < argc; ++i) {
    tgfxrn::IdleGate gate;
    std::string out;
    for (const char* p = argv[i]; *p != '\\0'; ++p) {
      if (*p == 'w') {
        gate.wake();
        out += 'w';
        continue;
      }
      switch (gate.tick(*p == 'T')) {
        case tgfxrn::IdleGate::Tick::Draw: out += 'D'; break;
        case tgfxrn::IdleGate::Tick::Skip: out += 'S'; break;
        case tgfxrn::IdleGate::Tick::Pause: out += 'P'; break;
      }
    }
    printf("%s\\n", out.c_str());
  }
  return 0;
}
`

// Requires a C++20 `c++` on PATH, as CI (ubuntu-latest / macos-15) has.
function run(): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'tgfx-idle-gate-'))
  try {
    const source = join(dir, 'main.cpp')
    const binary = join(dir, 'main')
    writeFileSync(source, PROGRAM)
    const include = resolve(import.meta.dir, '../../cpp')
    execFileSync('c++', ['-std=c++20', '-I', include, source, '-o', binary])
    return execFileSync(binary, [...PROGRAMS], { encoding: 'utf8' })
      .trim()
      .split('\n')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('a frame in flight is neither idle nor a consumed wake', () => {
  const [idle, wakeAfterPause, wakeDuringFrame, longFrame] = run()

  // The power optimisation, direction one: a still canvas pauses the link.
  expect(idle).toBe('DDDPP')
  // Direction two: setScene wakes it, and the very next tick draws.
  expect(wakeAfterPause).toBe('DDDPwD')

  // The regression: a frame-spanned tick neither pauses the link nor eats the wake.
  expect(wakeDuringFrame).toBe('DwSSSSSSD')
  expect(longFrame).toBe('DSSSSSSSSD')
})
