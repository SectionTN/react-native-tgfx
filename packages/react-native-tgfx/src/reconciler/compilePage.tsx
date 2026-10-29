// The ReactNode adapter for the offscreen renderers. The only reason the
// export path ever touches React - lazy-required from offscreen.ts so the
// imperative path never loads the reconciler.
import React, { type ReactNode } from 'react'
import { TgfxRoot } from './Reconciler'

/// Shared by every export entry point: the same reconciler, the same teardown ordering.
export function compilePage(
  element: ReactNode,
  what: string
): {
  buffer: ArrayBuffer
  strings: string[]
} {
  // Boxed: a `let` assigned only inside the callback narrows to `never` below.
  const out: { scene: { buffer: ArrayBuffer; strings: string[] } | null } = {
    scene: null,
  }
  const root = new TgfxRoot((buffer, strings) => {
    out.scene = { buffer, strings }
  })
  // A page compile reads refs, it does not adopt them: the live scene keeps
  // owning its handles, and this compile stays recognisably foreign to them.
  root.container.claimRefs = false
  try {
    root.renderSync(<>{element}</>)
    // React swallows a throwing component, so an empty root is how that surfaces.
    if (root.container.root.length === 0) {
      throw new Error(`[tgfx] ${what}: the scene compiled to nothing`)
    }
  } finally {
    // Muted first: tearing down commits an empty program that would replace the scene.
    root.container.muted = true
    root.unmount()
  }
  if (out.scene == null) {
    throw new Error(`[tgfx] ${what}: the scene compiled to nothing`)
  }
  return out.scene
}
