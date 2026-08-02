import { expect, test } from 'bun:test'
import { HARNESS_TIMEOUT_MS, runCppHarness } from '../testing/cppHarness'
import { packStringTable } from './writer'

// packStringTable (JS) and applyStringTable (C++) are one wire format. A writer
// that packs differently from how the reader unpacks does not error: it hands
// the engine a table whose indices no longer line up with the words.
const PAYLOAD = `data:image/png;base64,${'QUJDREVGR0g='.repeat(400)}`

/** The logical table each commit compiles to, in order. */
const COMMITS: string[][] = [
  [PAYLOAD],
  [PAYLOAD], // the image is unchanged; only geometry moved
  [PAYLOAD, 'M0 0L10 10'], // a <Path> joins the scene
  [PAYLOAD, 'M0 0L20 20'], // its data changes
  [PAYLOAD], // the path leaves; the table shrinks
  ['other', 'M0 0L20 20'], // the image itself changes
  [], // nothing references a string any more
]

const ENTRY_SEP = '\x1f'
const TABLE_SEP = '\x1e'

function pack(commits: string[][]): string[][] {
  let prev: string[] = []
  return commits.map((strings) => {
    const delta = packStringTable(prev, strings)
    prev = strings
    return delta
  })
}

function apply(packed: string[][]): string[][] {
  return run(packed).tables
}

/** 'same' when a commit reused the held allocation, 'new' when it rebuilt it. */
function allocations(packed: string[][]): string[] {
  return run(packed).allocations
}

function run(packed: string[][]): {
  tables: string[][]
  allocations: string[]
  warnings: string
} {
  const program = `#include <cstdio>
#include <memory>
#include <string>
#include <vector>
#include "SceneStrings.hpp"

int main() {
  const std::vector<tgfxrn::StringTable> packed = {
    ${packed
      .map((table) => `{${table.map((s) => JSON.stringify(s)).join(', ')}}`)
      .join(',\n    ')}
  };
  std::shared_ptr<const tgfxrn::StringTable> table =
      std::make_shared<const tgfxrn::StringTable>();
  for (const auto& delta : packed) {
    auto before = table;
    tgfxrn::applyStringTable(table, delta);
    // Reports the allocation, so a commit that must not re-copy can be asserted.
    printf("%s\\x1f", before.get() == table.get() ? "same" : "new");
    for (const auto& entry : *table) {
      printf("%s\\x1f", entry.c_str());
    }
    printf("\\x1e");
  }
  return 0;
}
`
  const out = runCppHarness('tgfx-string-table', program)
  const commits = out.stdout
    .split(TABLE_SEP)
    .slice(0, -1)
    .map((table) => table.split(ENTRY_SEP).slice(0, -1))
  return {
    tables: commits.map((entries) => entries.slice(1)),
    allocations: commits.map((entries) => entries[0]!),
    warnings: out.stderr,
  }
}

test(
  'the engine reconstructs the exact table the compiler produced',
  () => {
    expect(apply(pack(COMMITS))).toEqual(COMMITS)
  },
  HARNESS_TIMEOUT_MS
)

test('an unchanged payload crosses the boundary once', () => {
  const sizes = pack(COMMITS).map((delta) => delta.join('').length)
  // The first commit carries the payload; the redundant re-render after it must not.
  expect(sizes[0]).toBeGreaterThan(PAYLOAD.length)
  expect(sizes[1]).toBeLessThan(8)
  // Nor may an unrelated <Path> edit drag the image along with it.
  expect(sizes[3]).toBeLessThan(PAYLOAD.length)
})

test(
  'a carry-over larger than the held table is clamped and reported',
  () => {
    // What a dropped delta looks like from the reader's side: JS counts from its
    // own cursor, so the count can exceed everything the engine actually holds.
    // Silently trusting it would index words at entries that were never sent.
    const { tables, warnings } = run([['2', 'tail']])
    expect(tables).toEqual([['tail']])
    expect(warnings).toContain('carries over 2 entries but only 0 are held')
  },
  HARNESS_TIMEOUT_MS
)

test(
  'a redundant commit reuses the held table instead of re-copying it',
  () => {
    // The point of the delta: COMMITS[1] re-renders with the same payload, so the
    // engine must keep the allocation it already has. Rebuilding it there would
    // reinstate the per-commit copy of every payload this format exists to remove.
    const marks = allocations(pack(COMMITS))
    expect(marks[1]).toBe('same')
    expect(marks[0]).toBe('new')
    expect(marks[2]).toBe('new')
  },
  HARNESS_TIMEOUT_MS
)

test(
  'a carry-over past 2^32 is compared before it is narrowed',
  () => {
    // `size_t` is 32-bit on armeabi-v7a, where narrowing first turns 2^32 into 0
    // and the count sneaks under the clamp. This host is 64-bit, so it documents
    // the reporting rather than regression-testing the narrowing itself.
    const { warnings } = run([['4294967296', 'tail']])
    expect(warnings).toContain('carries over 4294967296 entries')
  },
  HARNESS_TIMEOUT_MS
)

test(
  'a delta with no header is ignored rather than emptying the table',
  () => {
    const { tables, warnings } = run([['0', 'kept'], []])
    expect(tables).toEqual([['kept'], ['kept']])
    expect(warnings).toContain('no header')
  },
  HARNESS_TIMEOUT_MS
)
