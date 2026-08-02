import { Children, Fragment, isValidElement, type ReactNode } from 'react'
import { createNode, NodeType, type Node, type NodeTypeName } from './types'

const HOST_TYPES = new Set<string>(Object.values(NodeType))

/**
 * Build the host-node tree straight from React elements, skipping the
 * reconciler.
 *
 * The reconciler exists so `<Canvas>` composes like real React — function
 * components, `.map()`, hooks and context all expand. That costs a fiber per
 * node per commit, which on a 400-object animation is the JS thread's largest
 * single expense (measured at ~52% of a core, against nitro-thor's 17.8% for
 * its whole JS thread, because thor reads `child.props` directly and never
 * mounts anything).
 *
 * Most scenes are just shape elements, and those need none of that machinery.
 * Returns null the moment anything is not a plain host element — a function
 * component, a raw string, a portal — and the caller falls back to the
 * reconciler, so composition keeps working exactly as before.
 */
export function directNodes(children: ReactNode): Node[] | null {
  const out: Node[] = []
  let ok = true
  Children.forEach(children, (child) => {
    if (!ok) {
      return
    }
    // `null`/`undefined`/`false` are legal empty children in JSX; React drops
    // them and so does the reconciler, so they are skipped, not a fallback.
    if (child == null || typeof child === 'boolean') {
      return
    }
    // A keyed `.map()` almost always wraps its items in a Fragment, which is
    // not a host element but adds no node of its own -- splice its children in.
    if (isValidElement(child) && child.type === Fragment) {
      const inner = directNodes(
        (child.props as { children?: ReactNode }).children
      )
      if (inner === null) {
        ok = false
        return
      }
      out.push(...inner)
      return
    }
    const node = toNode(child)
    if (node === null) {
      ok = false
      return
    }
    out.push(node)
  })
  return ok ? out : null
}

function toNode(child: ReactNode): Node | null {
  if (!isValidElement(child)) {
    return null
  }
  const type = child.type
  if (typeof type !== 'string' || !HOST_TYPES.has(type)) {
    return null
  }
  const props = child.props as Record<string, unknown>
  const node = createNode(type as NodeTypeName, props)
  const nested = props.children as ReactNode
  if (nested != null) {
    const kids = directNodes(nested)
    if (kids === null) {
      return null
    }
    node.children = kids
  }
  return node
}
