import { expect, test } from 'bun:test'
import { HARNESS_TIMEOUT_MS, runCppHarness } from '../testing/cppHarness'

// [path data, expected op stream]. parseSvgPath runs on the render thread, so the alarm gates it.
const CASES: [string, string][] = [
  ['M0 0 L10 10', 'M0,0 L10,10'],
  ['M0 0 10 10', 'M0,0 L10,10'],
  ['M0 0 C1 1 2 2 3 3', 'M0,0 C1,1 2,2 3,3'],
  ['M0 0 Q1 1 2 2', 'M0,0 Q1,1 2,2'],
  ['M0 0 H5 V5 Z', 'M0,0 L5,0 L5,5 Z'],
  ['M0 0 ZZ', 'M0,0 Z Z'],
  ['M0 0 Z', 'M0,0 Z'],
  // SVG 2 §9.3.9: render up to the command holding the first error; `Z` takes no arguments.
  ['M0 0 Z 1 1', 'M0,0 Z'],
  ['m0 0 z 1 1', 'M0,0 Z'],
  ['M0,0Z1,1', 'M0,0 Z'],
  ['M0 0 Z-1', 'M0,0 Z'],
  ['M0 0 L1 1 Z 0', 'M0,0 L1,1 Z'],
  ['M0 0 Z Z 5', 'M0,0 Z Z'],
  ['M0 0 Z ?', 'M0,0 Z'],
  ['M0 0 Z #', 'M0,0 Z'],
  ['M0 0 Z —', 'M0,0 Z'],
  ['M0 0 X 1 1', 'M0,0'],
  ['1 2 3', ''],
  ['', ''],
  // SVG 2 §9.3.8 via appendix F.6.5, whose `reversed` is the inverse of the SVG sweep flag.
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
  // The compact form: `flag` is one character, so `110-14` is 1, 1, 0, -14. Matches the case above.
  [
    'M8 15a7 7 0 110-14 7 7 0 010 14z',
    'M8,15 A7,7 0 1 0 8,1 A7,7 0 0 0 8,15 Z',
  ],
  ['M0 0a5 5 0 01-10 0', 'M0,0 A5,5 0 0 0 -10,0'],
  ['M0 0A5 5 0 0110 0', 'M0,0 A5,5 0 0 0 10,0'],
  // A flag that is neither 0 nor 1 is a path-data error, so the arc is not rendered.
  ['M0 0 A5 5 0 2 1 10 10', 'M0,0'],
  ['M0 0 A5 5 0', 'M0,0'],
  ['M0 0 A5 5 0 1 10 10', 'M0,0 A5,5 0 1 0 0,10'],
  ['M0 0A5 5 0 0 1 10 10L20 20', 'M0,0 A5,5 0 0 0 10,10 L20,20'],
  ['A5 5 0 0 1 10 10', 'M0,0 A5,5 0 0 0 10,10'],
]

const STUB = `#pragma once
#include <cstdio>
#include <string>
#include <vector>

namespace tgfx {
struct Point {
  float x, y;
  static Point Make(float x, float y) { return {x, y}; }
};
enum class PathArcSize { Small, Large };
// pathToSvg compiles against these; its real iteration is covered by cpp/tests/SceneTest.
enum class PathVerb { Move, Line, Quad, Conic, Cubic, Close, Done };

class Path {
 public:
  void moveTo(float x, float y) { add("M", x, y); }
  void lineTo(float x, float y) { add("L", x, y); }
  void quadTo(float x1, float y1, float x, float y) { add("Q", x1, y1); add("", x, y); }
  void cubicTo(float x1, float y1, float x2, float y2, float x, float y) {
    add("C", x1, y1); add("", x2, y2); add("", x, y);
  }
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

  struct Segment {
    PathVerb verb = PathVerb::Done;
    Point points[4] = {};
    float conicWeight = 0;
  };
  const Segment* begin() const { return nullptr; }
  const Segment* end() const { return nullptr; }
  static std::vector<Point> ConvertConicToQuads(const Point&, const Point&, const Point&, float,
                                                int = 1) {
    return {};
  }

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

function parseAll(): string[] {
  return runCppHarness('tgfx-svg-path', PROGRAM, {
    headers: { 'tgfx/core/Path.h': STUB },
    sources: ['SvgPath.cpp'],
  })
    .stdout.split('\n')
    .slice(0, CASES.length)
}

test(
  'parseSvgPath terminates and renders up to the first error',
  () => {
    const actual = parseAll()
    expect(CASES.map(([input], i) => `${input} -> ${actual[i]}`)).toEqual(
      CASES.map(([input, expected]) => `${input} -> ${expected}`)
    )
  },
  HARNESS_TIMEOUT_MS
)
