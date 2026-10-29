import type { NodeHandle } from '../imperative'
import type { CanvasHandle, HitTestOptions } from '../types'

/** What a press handler is told: the point, and everything under it. */
export interface CanvasPress {
  x: number
  y: number
  /** Topmost first, the same order {@link CanvasHandle.hitTest} returns. */
  nodes: (NodeHandle | null)[]
}

export interface CanvasPressOptions extends HitTestOptions {
  /** Called for every press, whatever it landed on - including nothing. */
  onPress?: (press: CanvasPress) => void
}

/**
 * Turn a canvas ref plus a map of handles into a press handler, so a tap
 * dispatches to whichever node was hit instead of to coordinates.
 *
 * The declarative half of {@link CanvasHandle.hitTest}: give it the handles you
 * care about and what to run for each.
 *
 * ```tsx
 * const bar = useNode()
 * const onTouch = useCanvasPress(canvas, [[bar, () => select(bar)]])
 *
 * <View onStartShouldSetResponder={() => true} onResponderRelease={onTouch}>
 *   <Canvas ref={canvas}>
 *     <Rect ref={bar} … />
 *   </Canvas>
 * </View>
 * ```
 *
 * Only the topmost hit fires, which is what a tap target should do - a handler
 * on a node underneath does not also run. Nodes with no handle are reported in
 * `onPress` but dispatch to nothing.
 */
export function useCanvasPress(
  canvas: { current: CanvasHandle | null },
  handlers: Iterable<readonly [NodeHandle, () => void]>,
  options: CanvasPressOptions = {}
): (event: { nativeEvent: { locationX: number; locationY: number } }) => void {
  const { precise, onPress } = options
  return (event) => {
    const { locationX, locationY } = event.nativeEvent
    const hits =
      canvas.current?.hitTest(locationX, locationY, { precise }) ?? []
    const nodes = hits.map((hit) => hit.node)
    onPress?.({ x: locationX, y: locationY, nodes })
    dispatchPress(nodes, handlers)
  }
}

/**
 * The topmost-wins dispatch on its own, for headless hit tests: feed it what
 * `Scene.handlesAt(surface.hitTest(x, y, precise))` names and the handlers you
 * care about. Returns whether anything ran.
 *
 * Only the topmost hit fires - a handler on a node underneath does not also
 * run - exactly as {@link useCanvasPress} dispatches on a canvas.
 */
export function dispatchPress(
  nodes: (NodeHandle | null)[],
  handlers: Iterable<readonly [NodeHandle, () => void]>
): boolean {
  // Built per press, not per render: it is a handful of entries and needs no hook.
  const map = new Map(handlers)
  for (const node of nodes) {
    const handler = node == null ? undefined : map.get(node)
    if (handler != null) {
      // Topmost wins: a tap belongs to one target, not to everything beneath it.
      handler()
      return true
    }
  }
  return false
}
