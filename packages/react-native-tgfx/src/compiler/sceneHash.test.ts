import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// hashScene is the native dedupe key: setScene drops any commit whose hash matches the previous one.
const CASES = [
  '{{1, 2, 3}, {"1"}}',
  '{{1, 2, 3}, {"2"}}',
  '{{1, 2, 3}, {"1"}}',
  '{{1, 2, 3}, {}}',
  '{{1, 2, 3}, {""}}',
  '{{1, 2, 3}, {"ab", "c"}}',
  '{{1, 2, 3}, {"a", "bc"}}',
  '{{1, 2, 3}, {"c", "ab"}}',
  '{{1, 2, 4}, {"1"}}',
  '{{7}, {""}}',
  // 4.9e-324 is the denormal whose eight bytes are u64(1), i.e. a table-size field.
  '{{7, 4.9e-324}, {}}',
]

const PROGRAM = `#include <cstdio>
#include <string>
#include <utility>
#include <vector>
#include "SceneHash.hpp"

int main() {
  const std::vector<std::pair<std::vector<double>, std::vector<std::string>>> cases = {
    ${CASES.join(',\n    ')}
  };
  for (const auto& item : cases) {
    printf("%llu\\n", (unsigned long long)tgfxrn::hashScene(
        tgfxrn::hashWords(item.first), tgfxrn::hashStrings(item.second)));
  }
  return 0;
}
`

// Requires a C++20 `c++` on PATH, as CI (ubuntu-latest / macos-15) has.
function hashScene(): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'tgfx-scene-hash-'))
  try {
    const source = join(dir, 'main.cpp')
    const binary = join(dir, 'main')
    writeFileSync(source, PROGRAM)
    const include = resolve(import.meta.dir, '../../cpp')
    execFileSync('c++', ['-std=c++20', '-I', include, source, '-o', binary])
    return execFileSync(binary, { encoding: 'utf8' }).trim().split('\n')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('hashScene covers the string table, not just the words', () => {
  const [
    text1,
    text2,
    text1Again,
    noTable,
    emptyString,
    abC,
    aBc,
    cAb,
    otherWords,
    shortWords,
    longWords,
  ] = hashScene()
  // The regression: <Text>{count}</Text> going 1 -> 2 leaves the words byte-identical.
  expect(text2).not.toBe(text1)
  expect(text1Again).toBe(text1)
  // An absent table, a single empty string, and a populated table are all distinct.
  expect(noTable).not.toBe(emptyString)
  expect(noTable).not.toBe(text1)
  // Re-splitting or permuting the same bytes must not collide.
  expect(aBc).not.toBe(abC)
  expect(cAb).not.toBe(abC)
  // And the words still count.
  expect(otherWords).not.toBe(text1)
  // A trailing word must not be able to stand in for the table-size field.
  expect(longWords).not.toBe(shortWords)
})
