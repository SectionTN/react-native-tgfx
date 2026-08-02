import { compileScene } from '../compiler/compile'
import type { MaybeSharedValue } from '../compiler/values'
import { SceneWriter } from '../compiler/writer'
import type { Node } from './types'

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
export class TgfxContainer {
  root: Node[] = []
  /** Drops commits while a torn-down root is about to be replaced. */
  muted = false
  private readonly writer = new SceneWriter()
  private readonly onCommit: CommitListener

  constructor(onCommit: CommitListener) {
    this.onCommit = onCommit
  }

  /** Swap in a root built without the reconciler, then compile as usual. */
  setRootDirect(roots: Node[]): void {
    this.root = roots
    this.redraw()
  }

  redraw(): void {
    if (this.muted) {
      return
    }
    const { buffer, strings, values } = compileScene(this.root, this.writer)
    this.onCommit(buffer, strings, values)
  }
}
