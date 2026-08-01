import { isSharedValue, type MaybeSharedValue } from './values'

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
export const SCENE_VERSION = 2

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
} as const

const HEADER_WORDS = 3

export class SceneWriter {
  private words = new Float64Array(4096)
  private n = HEADER_WORDS
  private readonly patches: number[] = []
  readonly strings: string[] = []
  private readonly stringIds = new Map<string, number>()
  readonly values: MaybeSharedValue<unknown>[] = []
  private readonly slots = new Map<object, number>()

  reset(): void {
    this.n = HEADER_WORDS
    this.patches.length = 0
    this.strings.length = 0
    this.stringIds.clear()
    this.values.length = 0
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
      this.push(0)
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
