// The compile graph must stay worklet-callable: the file-level directive makes
// the babel plugin workletize every top-level function, so a scene can be
// built and compiled on a worklet runtime. Losing one directive breaks that
// silently — bun never runs the plugin, only a device would notice.
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const WORKLETIZED = [
  'compiler/colors.ts',
  'compiler/compile.ts',
  'compiler/filters.ts',
  'compiler/image.ts',
  'compiler/paint.ts',
  'compiler/sksl.ts',
  'compiler/text.ts',
  'compiler/transform.ts',
  'compiler/values.ts',
  'compiler/writer.ts',
  'elements.ts',
  'imperative.ts',
  'reconciler/types.ts',
  'reconciler/Container.ts',
  'reanimated/slotFlags.ts',
]

describe('workletized compile graph', () => {
  for (const file of WORKLETIZED) {
    it(`${file} keeps the file-level 'worklet' directive`, () => {
      const source = readFileSync(join(import.meta.dir, file), 'utf8')
      expect(source.startsWith("'worklet'")).toBe(true)
    })
  }
})
