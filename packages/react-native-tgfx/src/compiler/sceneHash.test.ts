import { expect, test } from 'bun:test'
import { HARNESS_TIMEOUT_MS, runCppHarness } from '../testing/cppHarness'

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

function hashScene(): string[] {
  return runCppHarness('tgfx-scene-hash', PROGRAM).stdout.trim().split('\n')
}

test(
  'hashScene covers the string table, not just the words',
  () => {
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
    expect(noTable).not.toBe(emptyString)
    expect(noTable).not.toBe(text1)
    expect(aBc).not.toBe(abC)
    expect(cAb).not.toBe(abC)
    expect(otherWords).not.toBe(text1)
    // A trailing word must not be able to stand in for the table-size field.
    expect(longWords).not.toBe(shortWords)
  },
  HARNESS_TIMEOUT_MS
)
