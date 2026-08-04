import type { NodeHandle } from '../imperative'
import { isSharedValue, resolveNumber, type MaybeSharedValue } from './values'

/**
 * Writer for the binary draw-program the native engine consumes.
 *
 * The program is a flat `Float64Array` written in tree preorder, so compiling a
 * scene is a run of stores into one reused buffer — no intermediate objects and
 * no JSON. Strings (path data, text, image sources, shader source) are rare and
 * variable-width, so they travel beside the buffer in a string table and the
 * buffer holds their indices.
 *
 * Layout, in words:
 *
 *     [0] VERSION
 *     [1] total word count
 *     [2] first word of the slot-patch table
 *     [3..] node stream
 *     [patch table] count, then (wordIndex, slotIndex) pairs
 *
 * A field backed by a Reanimated SharedValue is written as 0 and recorded in the
 * patch table, so the engine knows which words to resolve against the live value
 * array each frame.
 */
// 6: shader uniform floats may carry patch entries. The layout is unchanged,
// but a reader that walks them with a plain read leaves the patch cursor
// stranded, freezing every animated field after them.
// 7: adds the Fill kind, which an older reader would not draw.
// 8: images travel as an integer handle into the native ImageRegistry instead
// of a base64 string-table entry, and carry a full paint, the extended fit set,
// a sampling mode and an optional source rect. Adds the image shader kind.
// 9: a runtime shader carries a preamble string and its function names after
// the body, so an older reader would read them as the uniform count.
// 10: a paint whose flags carry bit 4 writes a filter block (blend mode, colour
// filter, image filter) between the alpha and the shader. Unfiltered paints are
// byte-identical to 9, but an older reader would take the block for a shader.
// 11: text carries a weight/style/spacing block and a paragraph block (wrap
// width, alignment, line height, maxLines, ellipsis) an older reader would walk
// straight past into the paint. Adds the text-path kind.
// 12: a runtime shader carries a child count and that many nested shader
// payloads after its uniforms, which an older reader would take for a paint.
// 13: adds the camera-frame kind, which carries children like a group but
// derives its transform from the live frame, so an older reader would take its
// image handle for a node kind.
// 14: text carries a run list — a count, then per run the string, the face it
// overrides and an optional colour — where it used to carry one string before
// the font block. A <Text> with no <Span> children writes one run that overrides
// nothing, but the words moved either way, so an older reader would take the
// count for a string index.
// 15: adds the glyph kind, whose ids and positions an older reader would take
// for a paragraph block.
export const SCENE_VERSION = 15

/**
 * Encode a string table as a delta against the one the engine already holds:
 * element 0 is the number of leading entries it keeps, the rest replaces
 * everything after them. Entries carry the payloads that scale with content
 * rather than node count — path data, text, shader source — and they are
 * byte-identical across commits, so re-sending them costs a Nitro marshal, a
 * UTF-8 conversion and a full hash scan per commit for nothing. Images are not
 * among them: they travel as an integer handle.
 * Decoded by applyStringTable() in cpp/SceneStrings.hpp.
 */
export function packStringTable(prev: string[], next: string[]): string[] {
  let kept = 0
  while (
    kept < prev.length &&
    kept < next.length &&
    prev[kept] === next[kept]
  ) {
    kept++
  }
  const packed: string[] = [String(kept)]
  for (let i = kept; i < next.length; i++) {
    packed.push(next[i] as string)
  }
  return packed
}

export const Kind = {
  Group: 0,
  Rect: 1,
  RRect: 2,
  Oval: 3,
  Circle: 4,
  Line: 5,
  Path: 6,
  Image: 7,
  Text: 8,
  Fill: 9,
  TextPath: 10,
  CameraFrame: 11,
  Glyphs: 12,
} as const

const HEADER_WORDS = 3

export class SceneWriter {
  private words = new Float64Array(4096)
  private n = HEADER_WORDS
  private readonly patches: number[] = []
  readonly strings: string[] = []
  private readonly stringIds = new Map<string, number>()
  readonly values: MaybeSharedValue<unknown>[] = []
  /** The node handles this program is addressable through, in write order. */
  readonly refs: NodeHandle[] = []
  /** Whether this compile re-reads handled props from the element tree. */
  reseed = true
  private readonly slots = new Map<object, number>()

  reset(): void {
    this.n = HEADER_WORDS
    this.patches.length = 0
    this.strings.length = 0
    this.stringIds.clear()
    this.values.length = 0
    this.refs.length = 0
    this.slots.clear()
  }

  push(value: number): void {
    if (this.n === this.words.length) {
      const grown = new Float64Array(this.words.length * 2)
      grown.set(this.words)
      this.words = grown
    }
    this.words[this.n++] = value
  }

  /** Write a numeric field, recording a patch when it is animated. */
  pushAnim(value: unknown, fallback = 0): void {
    if (isSharedValue(value)) {
      this.patches.push(this.n, this.slot(value))
      // The literal is what native resolves against until the first setValues,
      // and a never-changing shared value never gets one.
      this.push(resolveNumber(value, fallback))
      return
    }
    const n = Number(value ?? fallback)
    this.push(Number.isFinite(n) ? n : fallback)
  }

  /** Reserve a word and return its index, for counts known only afterwards. */
  reserve(): number {
    const at = this.n
    this.push(0)
    return at
  }

  patch(at: number, value: number): void {
    this.words[at] = value
  }

  /** Intern a string and return its index in the string table. */
  pushString(value: string): void {
    let index = this.stringIds.get(value)
    if (index === undefined) {
      index = this.strings.length
      this.strings.push(value)
      this.stringIds.set(value, index)
    }
    this.push(index)
  }

  /** True when this value ended up with a slot the engine patches per frame. */
  hasSlot(value: MaybeSharedValue<unknown>): boolean {
    return this.slots.has(value as object)
  }

  private slot(sv: MaybeSharedValue<unknown>): number {
    const existing = this.slots.get(sv as object)
    if (existing !== undefined) {
      return existing
    }
    const index = this.values.length
    this.values.push(sv)
    this.slots.set(sv as object, index)
    return index
  }

  /** Close the program and return the buffer holding it. */
  finish(): ArrayBuffer {
    const patchStart = this.n
    this.push(this.patches.length / 2)
    for (const value of this.patches) {
      this.push(value)
    }
    this.words[0] = SCENE_VERSION
    this.words[1] = this.n
    this.words[2] = patchStart
    return this.words.buffer as ArrayBuffer
  }
}
