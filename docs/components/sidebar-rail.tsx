'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

// The desktop aside and the mobile drawer are separate elements; only one is mounted.
const CONTAINER =
  ':is(#nd-sidebar, #nd-sidebar-mobile) [data-radix-scroll-area-viewport] > div'

type Box = { y: number; h: number }

export function SidebarRail() {
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [box, setBox] = useState<Box | null>(null)

  useEffect(() => {
    // The mobile sidebar is a drawer, so the container comes and goes with it.
    const resolve = () => {
      const container = document.querySelector<HTMLElement>(CONTAINER)
      setHost((prev) => (prev === container ? prev : container))

      const active = container?.querySelectorAll<HTMLElement>('a[data-active="true"]')
      // Section links render before the page tree, so the page's own entry is last.
      const item = active?.[active.length - 1]
      // Mid-navigation the old entry can clear before the new one sets, so hold
      // the last position rather than blinking the rail out and back in.
      if (!item || !container) return
      // Rects, not offsetTop: inside a collapsible folder the link's offsetParent
      // is the folder, which would park the rail near the top of the list.
      const y = item.getBoundingClientRect().top - container.getBoundingClientRect().top
      const next = { y, h: item.offsetHeight }
      setBox((prev) => (prev?.y === next.y && prev?.h === next.h ? prev : next))
    }

    const observer = new MutationObserver(resolve)
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-active'],
    })
    // Folder collapse animations move the active link after the mutation settles.
    const sizeObserver = new ResizeObserver(resolve)
    const container = document.querySelector<HTMLElement>(CONTAINER)
    if (container) sizeObserver.observe(container)
    resolve()

    return () => {
      observer.disconnect()
      sizeObserver.disconnect()
    }
  }, [])

  // Held back until the position is known, or the first paint transitions in
  // from the top of the list instead of simply being there.
  if (!host || !box) return null

  return createPortal(
    <span
      className="tg-nav-rail"
      style={{ transform: `translateY(${box.y + 4}px)`, height: box.h - 8 }}
      aria-hidden="true"
    />,
    host
  )
}
