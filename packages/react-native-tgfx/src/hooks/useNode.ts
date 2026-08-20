import { useRef } from 'react'
import { createHandle, type NodeHandle } from '../imperative'

/**
 * A stable {@link NodeHandle} for a drawing node. Pass it as `ref` and keep it
 * for the life of the component — it owns the node's live values, so a handle
 * recreated per render would lose them.
 */
export function useNode(): NodeHandle {
  const ref = useRef<NodeHandle | null>(null)
  if (ref.current == null) {
    ref.current = createHandle()
  }
  return ref.current
}
