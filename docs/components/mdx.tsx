import defaultComponents from 'fumadocs-ui/mdx'
import type { MDXComponents } from 'mdx/types'
import type { ReactNode } from 'react'

type Thread = 'js' | 'native'

const THREAD_LABEL: Record<Thread, string> = {
  js: 'JS thread',
  native: 'render thread',
}

/** Names which thread pays for a thing. Never colour alone — the label is the signal. */
export function Thread({ on }: { on: Thread }) {
  return (
    <span className="tg-thread" data-thread={on}>
      {THREAD_LABEL[on]}
    </span>
  )
}

/** A block of prose owned by one thread, railed in that thread's hue. */
export function Owned({ by, children }: { by: Thread; children: ReactNode }) {
  return (
    <div className="tg-rail my-6" data-thread={by}>
      <Thread on={by} />
      <div className="mt-2">{children}</div>
    </div>
  )
}

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return { ...defaultComponents, Thread, Owned, ...components }
}
