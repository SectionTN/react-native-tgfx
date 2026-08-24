import { expect, test } from 'bun:test'
import { HARNESS_TIMEOUT_MS, runCppHarness } from '../testing/cppHarness'

// Script alphabet: w = wakeUp, t = idle tick, T = tick during an in-flight frame.
const PROGRAMS = [
  'ttttt',
  'ttttwt',
  // #36: a wake during a long frame must survive it, and no skipped tick counts as idle.
  'twTTTTTTt',
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

function run(): string[] {
  return runCppHarness('tgfx-idle-gate', PROGRAM, { args: PROGRAMS })
    .stdout.trim()
    .split('\n')
}

test(
  'a frame in flight is neither idle nor a consumed wake',
  () => {
    const [idle, wakeAfterPause, wakeDuringFrame, longFrame] = run()

    expect(idle).toBe('DDDPP')
    expect(wakeAfterPause).toBe('DDDPwD')

    // The regression: a frame-spanned tick neither pauses the link nor eats the wake.
    expect(wakeDuringFrame).toBe('DwSSSSSSD')
    expect(longFrame).toBe('DSSSSSSSSD')
  },
  HARNESS_TIMEOUT_MS
)
