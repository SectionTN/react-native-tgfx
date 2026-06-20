import { createContext, type ReactNode } from 'react'
import ReactReconciler from 'react-reconciler'
import {
  ConcurrentRoot,
  DefaultEventPriority,
  NoEventPriority,
} from 'react-reconciler/constants'
import { TgfxContainer, type CommitListener } from './Container'
import { createNode, type Node, type NodeTypeName } from './types'

/**
 * A persistence-mode react-reconciler host config (the same architecture
 * react-native-skia uses): host instances are immutable `{ type, props,
 * children }` nodes, every change clones the tree, and the whole root is
 * replaced on commit. `resetAfterCommit` then compiles and pushes the scene.
 */

type Instance = Node
type Container = TgfxContainer

// React reads/writes the "current update priority" through these three hooks.
let currentUpdatePriority: number = NoEventPriority

// A stable (non-null) host context — react-reconciler warns "Expected host
// context to exist" if getRootHostContext/getChildHostContext returns null.
const HOST_CONTEXT = {}

const HostTransitionContext = createContext<unknown>(null)

function shallowEqualProps(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const ak = Object.keys(a)
  const bk = Object.keys(b)
  if (ak.length !== bk.length) {
    return false
  }
  for (const k of ak) {
    if (a[k] !== b[k]) {
      return false
    }
  }
  return true
}

const hostConfig = {
  supportsMutation: false,
  supportsPersistence: true,
  supportsHydration: false,
  isPrimaryRenderer: false,
  noTimeout: -1 as const,
  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,

  createInstance(type: NodeTypeName, props: Record<string, unknown>): Instance {
    // `props.children` are React elements, never read by the compiler (which
    // walks `node.children`), so we keep props as-is.
    return createNode(type, props)
  },
  createTextInstance(text: string): Instance {
    // Raw strings are not drawable; keep an inert node so a stray string child
    // never crashes a render (the compiler ignores unknown node types).
    return createNode('tgfx_rawtext' as NodeTypeName, { text })
  },
  appendInitialChild(parent: Instance, child: Instance): void {
    parent.children.push(child)
  },
  finalizeInitialChildren(): boolean {
    return false
  },
  shouldSetTextContent(): boolean {
    return false
  },
  getRootHostContext(): object {
    return HOST_CONTEXT
  },
  getChildHostContext(): object {
    return HOST_CONTEXT
  },
  getPublicInstance(instance: Instance): Instance {
    return instance
  },
  prepareForCommit(): null {
    return null
  },
  resetAfterCommit(container: Container): void {
    container.redraw()
  },
  preparePortalMount(): void {},

  // ---- Persistence ----
  cloneInstance(
    instance: Instance,
    type: NodeTypeName,
    oldProps: Record<string, unknown>,
    newProps: Record<string, unknown>,
    keepChildren: boolean
  ): Instance {
    // Reuse the instance when nothing changed to avoid extra recompiles.
    if (keepChildren && shallowEqualProps(oldProps, newProps)) {
      return instance
    }
    return {
      type,
      props: newProps,
      children: keepChildren ? [...instance.children] : [],
    }
  },
  cloneHiddenInstance(instance: Instance, type: NodeTypeName, props: Record<string, unknown>): Instance {
    return { type, props, children: [...instance.children] }
  },
  cloneHiddenTextInstance(instance: Instance): Instance {
    return instance
  },
  createContainerChildSet(): Instance[] {
    return []
  },
  appendChildToContainerChildSet(childSet: Instance[], child: Instance): void {
    childSet.push(child)
  },
  finalizeContainerChildren(): void {},
  replaceContainerChildren(container: Container, newChildren: Instance[]): void {
    container.root = newChildren
  },
  clearContainer(container: Container): void {
    container.root = []
  },

  // ---- Misc required hooks ----
  getInstanceFromNode: () => null,
  beforeActiveInstanceBlur: () => {},
  afterActiveInstanceBlur: () => {},
  prepareScopeUpdate: () => {},
  getInstanceFromScope: () => null,
  detachDeletedInstance: () => {},

  // ---- Update priority ----
  setCurrentUpdatePriority(priority: number): void {
    currentUpdatePriority = priority
  },
  getCurrentUpdatePriority(): number {
    return currentUpdatePriority
  },
  resolveUpdatePriority(): number {
    return currentUpdatePriority !== NoEventPriority
      ? currentUpdatePriority
      : DefaultEventPriority
  },

  // ---- Transitions / suspense (unused but accessed by React 19) ----
  NotPendingTransition: null,
  HostTransitionContext,
  resetFormInstance: () => {},
  requestPostPaintCallback: () => {},
  shouldAttemptEagerTransition: () => false,
  trackSchedulerEvent: () => {},
  resolveEventType: () => null,
  resolveEventTimeStamp: () => -1,
  maySuspendCommit: () => false,
  preloadInstance: () => true,
  startSuspendingCommit: () => {},
  suspendInstance: () => {},
  waitForCommitToBeReady: () => null,
}

// The full HostConfig type is enormous; we provide exactly the members React 19
// invokes at runtime, so we cast at the boundary.
const reconciler = ReactReconciler(
  hostConfig as unknown as Parameters<typeof ReactReconciler>[0]
)

/** A mounted reconciler root that renders a React element tree into a container. */
export class TgfxRoot {
  private readonly container: TgfxContainer
  private readonly root: ReturnType<typeof reconciler.createContainer>

  constructor(onCommit: CommitListener) {
    this.container = new TgfxContainer(onCommit)
    this.root = reconciler.createContainer(
      this.container,
      ConcurrentRoot,
      null,
      false,
      null,
      '',
      (error: Error) => console.error('[tgfx] uncaught error:', error),
      (error: Error) => console.error('[tgfx] caught error:', error),
      (error: Error) => console.error('[tgfx] recoverable error:', error),
      () => {}
    )
  }

  render(element: ReactNode): void {
    reconciler.updateContainer(element, this.root, null, null)
  }

  unmount(): void {
    reconciler.updateContainer(null, this.root, null, null)
  }
}
