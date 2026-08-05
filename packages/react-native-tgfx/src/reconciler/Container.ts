import { compileScene } from '../compiler/compile'
import type { MaybeSharedValue } from '../compiler/values'
import { SceneWriter } from '../compiler/writer'
import { nodeInternals, type NodeOwner } from '../imperative'
import type { Node } from './types'

let warnedShared = false

/** Called on each committed change with the draw program and its animated values. */
export type CommitListener = (
  buffer: ArrayBuffer,
  strings: string[],
  values: MaybeSharedValue<unknown>[]
) => void

/**
 * The reconciler container. Holds the immutable root node list produced by the
 * persistence-mode host config and, on each committed change, compiles it into
 * the binary draw program plus the ordered animated SharedValues.
 */
export class TgfxContainer implements NodeOwner {
  root: Node[] = []
  muted = false
  onValues: ((values: number[]) => void) | null = null
  private readonly writer = new SceneWriter()
  private readonly onCommit: CommitListener
  private values: MaybeSharedValue<unknown>[] = []
  private readonly scratch: number[] = []

  constructor(onCommit: CommitListener) {
    this.onCommit = onCommit
  }

  setRootDirect(roots: Node[]): void {
    this.root = roots
    this.redraw()
  }

  redraw(fromReact = true): void {
    if (this.muted) {
      return
    }
    const { buffer, strings, values, refs } = compileScene(
      this.root,
      this.writer,
      fromReact
    )
    this.values = values
    for (let i = 0; i < refs.length; i++) {
      const ref = refs[i]!
      if (!warnedShared && refs.indexOf(ref) !== i) {
        warnedShared = true
        console.warn(
          '[tgfx] one node handle is on more than one node: they share its value slots, so a write moves all of them together. Use one handle per node.'
        )
      }
      nodeInternals(ref).bind(this, this.writer)
    }
    this.onCommit(buffer, strings, values)
  }

  recompile(): void {
    this.redraw(false)
  }

  pushValues(): void {
    if (this.values.length === 0) {
      // Nothing to patch, and an empty push still costs the render thread a redraw on Android.
      return
    }
    const out = this.scratch
    out.length = this.values.length
    for (let i = 0; i < this.values.length; i++) {
      out[i] = Number(this.values[i]!.value)
    }
    this.onValues?.(out)
  }
}
