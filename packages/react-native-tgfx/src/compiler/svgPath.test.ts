import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// [path data, expected op stream]. parseSvgPath runs on the render thread, so a
// case that never returns wedges every canvas in the process: the alarm below
// turns that into a failure instead of a hung test run.
const CASES: [string, string][] = [
  ['M0 0 L10 10', 'M0,0 L10,10'],
  ['M0 0 10 10', 'M0,0 L10,10'],
  ['M0 0 C1 1 2 2 3 3', 'M0,0 C1,1 2,2 3,3'],
  ['M0 0 Q1 1 2 2', 'M0,0 Q1,1 2,2'],
  ['M0 0 H5 V5 Z', 'M0,0 L5,0 L5,5 Z'],
  ['M0 0 ZZ', 'M0,0 Z Z'],
  ['M0 0 Z', 'M0,0 Z'],
  // SVG 2 §9.3.9: render up to but not including the command holding the first
  // error. `closepath ::= ("Z" | "z")` takes no arguments, so the trailing
  // tokens are an error, not an implicit lineto.
  ['M0 0 Z 1 1', 'M0,0 Z'],
  ['m0 0 z 1 1', 'M0,0 Z'],
  ['M0,0Z1,1', 'M0,0 Z'],
  ['M0 0 Z-1', 'M0,0 Z'],
  ['M0 0 L1 1 Z 0', 'M0,0 L1,1 Z'],
  ['M0 0 Z Z 5', 'M0,0 Z Z'],
  // Any byte that is neither a command nor a separator triggers it, not just digits.
  ['M0 0 Z ?', 'M0,0 Z'],
  ['M0 0 Z #', 'M0,0 Z'],
  ['M0 0 Z —', 'M0,0 Z'],
  ['M0 0 X 1 1', 'M0,0'],
  ['1 2 3', ''],
  ['', ''],
]

const STUB = `#pragma once
#include <cstdio>
#include <string>

namespace tgfx {
class Path {
 public:
  void moveTo(float x, float y) { add("M", x, y); }
  void lineTo(float x, float y) { add("L", x, y); }
  void quadTo(float x1, float y1, float x, float y) { add("Q", x1, y1); add("", x, y); }
  void cubicTo(float x1, float y1, float x2, float y2, float x, float y) {
    add("C", x1, y1); add("", x2, y2); add("", x, y);
  }
  void close() { if (!ops.empty()) ops += ' '; ops += 'Z'; }
  std::string ops;

 private:
  void add(const char* op, float x, float y) {
    char buf[64];
    snprintf(buf, sizeof(buf), "%s%g,%g", op, x, y);
    if (!ops.empty()) ops += ' ';
    ops += buf;
  }
};
}  // namespace tgfx
`

const PROGRAM = `#include <cstdio>
#include <string>
#include <unistd.h>
#include <vector>
#include "SvgPath.hpp"

int main() {
  alarm(3);
  const std::vector<std::string> cases = {
    ${CASES.map(([input]) => `R"(${input})"`).join(',\n    ')}
  };
  for (const auto& item : cases) {
    printf("%s\\n", tgfxrn::parseSvgPath(item).ops.c_str());
    fflush(stdout);
  }
  return 0;
}
`

// Requires a C++20 `c++` on PATH, as CI (ubuntu-latest / macos-15) has.
function parseAll(): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'tgfx-svg-path-'))
  try {
    const stubDir = join(dir, 'tgfx', 'core')
    mkdirSync(stubDir, { recursive: true })
    writeFileSync(join(stubDir, 'Path.h'), STUB)
    const source = join(dir, 'main.cpp')
    const binary = join(dir, 'main')
    writeFileSync(source, PROGRAM)
    const cpp = resolve(import.meta.dir, '../../cpp')
    execFileSync('c++', [
      '-std=c++20',
      '-I', dir,
      '-I', cpp,
      source,
      join(cpp, 'SvgPath.cpp'),
      '-o', binary,
    ])
    return execFileSync(binary, { encoding: 'utf8' }).split('\n').slice(0, CASES.length)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('parseSvgPath terminates and renders up to the first error', () => {
  const actual = parseAll()
  expect(CASES.map(([input], i) => `${input} -> ${actual[i]}`)).toEqual(
    CASES.map(([input, expected]) => `${input} -> ${expected}`)
  )
})
