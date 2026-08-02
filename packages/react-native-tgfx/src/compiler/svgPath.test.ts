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
  // SVG 2 §9.3.8: `A` carries rx ry rot large-arc sweep x y, converted to a
  // centre parameterisation by appendix F.6.5. tgfx::Path::arcTo implements
  // F.6.5, but its `reversed` is the inverse of the SVG sweep flag.
  [
    'M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14z',
    'M8,15 A7,7 0 1 0 8,1 A7,7 0 0 0 8,15 Z',
  ],
  [
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
    'M12,21 A9,9 0 1 1 12,3 A9,9 0 0 1 12,21 Z',
  ],
  [
    'M22 12 A10 10 0 1 1 2 12 A10 10 0 1 1 22 12 Z',
    'M22,12 A10,10 0 1 0 2,12 A10,10 0 1 0 22,12 Z',
  ],
  // The compact form svgo/Figma emit: `flag ::= "0" | "1"` is one character, so
  // `110-14` is large-arc=1, sweep=1, 0, -14. Reading it as the number 110
  // desynchronises every later token, eating the `z`. Must match the case above.
  [
    'M8 15a7 7 0 110-14 7 7 0 010 14z',
    'M8,15 A7,7 0 1 0 8,1 A7,7 0 0 0 8,15 Z',
  ],
  ['M0 0a5 5 0 01-10 0', 'M0,0 A5,5 0 0 0 -10,0'],
  ['M0 0A5 5 0 0110 0', 'M0,0 A5,5 0 0 0 10,0'],
  // A flag that is neither 0 nor 1 is a path-data error: render up to but not
  // including the arc, same rule §9.3.9 applies to the trailing-token cases above.
  ['M0 0 A5 5 0 2 1 10 10', 'M0,0'],
  ['M0 0 A5 5 0', 'M0,0'],
  // Whitespace does not make a flag wider: `1 10 10` is flag 1, then 0, then 10.
  ['M0 0 A5 5 0 1 10 10', 'M0,0 A5,5 0 1 0 0,10'],
  // Arcs are still the current point's successor: the next command follows on.
  ['M0 0A5 5 0 0 1 10 10L20 20', 'M0,0 A5,5 0 0 0 10,10 L20,20'],
  ['A5 5 0 0 1 10 10', 'M0,0 A5,5 0 0 0 10,10'],
]

const STUB = `#pragma once
#include <cstdio>
#include <string>

namespace tgfx {
struct Point {
  float x, y;
  static Point Make(float x, float y) { return {x, y}; }
};
enum class PathArcSize { Small, Large };

class Path {
 public:
  void moveTo(float x, float y) { add("M", x, y); }
  void lineTo(float x, float y) { add("L", x, y); }
  void quadTo(float x1, float y1, float x, float y) { add("Q", x1, y1); add("", x, y); }
  void cubicTo(float x1, float y1, float x2, float y2, float x, float y) {
    add("C", x1, y1); add("", x2, y2); add("", x, y);
  }
  // Records what tgfx is handed, sweep already inverted into \`reversed\`.
  void arcTo(float rx, float ry, float rot, PathArcSize largeArc, bool reversed, Point end) {
    char buf[128];
    snprintf(buf, sizeof(buf), "A%g,%g %g %d %d %g,%g", rx, ry, rot,
             largeArc == PathArcSize::Large ? 1 : 0, reversed ? 1 : 0, end.x, end.y);
    if (!ops.empty()) ops += ' ';
    ops += buf;
  }
  void close() { if (!ops.empty()) ops += ' '; ops += 'Z'; }
  bool isEmpty() const { return ops.empty(); }
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
    execFileSync(
      'c++',
      [
        '-std=c++20',
        '-I',
        dir,
        '-I',
        cpp,
        source,
        join(cpp, 'SvgPath.cpp'),
        '-o',
        binary,
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] }
    )
    return execFileSync(binary, { encoding: 'utf8' })
      .split('\n')
      .slice(0, CASES.length)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// Timeout covers the c++ invocation, not the parser: `alarm` above guards that.
test('parseSvgPath terminates and renders up to the first error', () => {
  const actual = parseAll()
  expect(CASES.map(([input], i) => `${input} -> ${actual[i]}`)).toEqual(
    CASES.map(([input, expected]) => `${input} -> ${expected}`)
  )
}, 60_000)
