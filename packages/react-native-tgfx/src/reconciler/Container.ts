import { compileScene } from '../compiler/compile'
import type { MaybeSharedValue } from '../compiler/values'
import type { Node } from './types'

/** Called on each committed change with the scene JSON and its animated values. */
export type CommitListener = (
  json: string,
  values: MaybeSharedValue<unknown>[]
) => void

/**
 * The reconciler container. Holds the immutable root node list produced by the
 * persistence-mode host config and, on each committed change, compiles it into
 * the serialized scene plus the ordered animated SharedValues.
 */
export class TgfxContainer {
  root: Node[] = []
  private readonly onCommit: CommitListener

  constructor(onCommit: CommitListener) {
    this.onCommit = onCommit
  }

  redraw(): void {
    const { json, values } = compileScene(this.root)
    this.onCommit(json, values)
  }
}
