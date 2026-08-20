import type { NodeHandle } from '../imperative'
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
  values: MaybeSharedValue<unknown>[],
  stringValues: MaybeSharedValue<string>[]
) => void

/**
 * The reconciler container. Holds the immutable root node list produced by the
 * persistence-mode host config and, on each committed change, compiles it into
 * the binary draw program plus the ordered animated SharedValues.
 */
export class TgfxContainer implements NodeOwner {
  root: Node[] = []
  muted = false
  /**
   * Whether commits bind this container as the refs' owner. A throwaway export
   * container turns it off: stealing ownership would strand the live scene's
   * handles on a muted container and misclassify its next commit as foreign.
   */
  claimRefs = true
  onValues: ((values: number[]) => void) | null = null
  onStrings: ((indices: number[], values: string[]) => void) | null = null
  private readonly writer = new SceneWriter()
  /// Rebuilt each commit: hit results come back as index paths and need naming.
  refPaths: { path: number[]; ref: NodeHandle }[] = []
  /// Keyed for hit results, which arrive as paths and would otherwise rescan the list.
  readonly byPath = new Map<string, NodeHandle>()
  private readonly onCommit: CommitListener
  private values: MaybeSharedValue<unknown>[] = []
  private stringValues: MaybeSharedValue<string>[] = []
  private readonly sentStrings: (string | null)[] = []
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
    const { buffer, strings, values, stringValues, refs, refPaths } =
      compileScene(this.root, this.writer, fromReact)
    this.values = values
    this.stringValues = stringValues
    // The program carries current literals, so nothing is pending for the new table.
    this.sentStrings.length = stringValues.length
    for (let i = 0; i < stringValues.length; i++) {
      this.sentStrings[i] = String(stringValues[i]!.value ?? '')
    }
    this.refPaths = refPaths
    this.byPath.clear()
    for (const entry of refPaths) {
      this.byPath.set(entry.path.join(','), entry.ref)
    }
    if (this.claimRefs) {
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
    }
    this.onCommit(buffer, strings, values, stringValues)
  }

  recompile(): void {
    this.redraw(false)
  }

  pushValues(): void {
    this.pushStrings()
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

  /// The changed string slots only; an unchanged frame sends nothing.
  private pushStrings(): void {
    if (this.stringValues.length === 0 || this.onStrings == null) {
      return
    }
    let indices: number[] | null = null
    let out: string[] | null = null
    for (let i = 0; i < this.stringValues.length; i++) {
      const now = String(this.stringValues[i]!.value ?? '')
      if (now === this.sentStrings[i]) {
        continue
      }
      this.sentStrings[i] = now
      ;(indices ??= []).push(i)
      ;(out ??= []).push(now)
    }
    if (indices != null && out != null) {
      this.onStrings(indices, out)
    }
  }
}
