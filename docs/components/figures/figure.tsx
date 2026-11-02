'use client'

import { useTheme } from 'next-themes'
import { type ReactNode, useEffect, useState } from 'react'
import { Code, type CodeLine, Phone, Stage, type StageProps, tokens, Window } from './kit'
import './figure.css'

// Every docs figure shares one composition: the editor holding the code is the
// hero, pinned top-left and running off the bottom; the phone running it
// straddles the editor's right edge over its empty margin. The canvas on the
// phone is what tgfx draws, so it is drawn with SVG at the screen's own points
// (402 wide), below the status bar.

export const ACCENT = '#7c3aed'

/** Wide design size; the stage scales down below it and up to fill the column. */
export const WIDE = { width: 760, height: 380 } as const
export const COMPACT = { below: 600, width: 358, height: 480 } as const

/** The docs theme, resolved after mount so the server render stays light. */
export function useDocsTheme(): 'light' | 'dark' {
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  return mounted && resolvedTheme === 'dark' ? 'dark' : 'light'
}

type FigureProps<S extends object> = Omit<StageProps<S>, 'width' | 'height' | 'theme' | 'children'> & {
  /** What the figure shows, for screen readers. */
  label: string
  children: StageProps<S>['children']
}

export function Figure<S extends object>({ label, className, ...stage }: FigureProps<S>) {
  const theme = useDocsTheme()
  return (
    <figure className="tgf not-prose" aria-label={label}>
      <Stage
        width={WIDE.width}
        height={WIDE.height}
        compact={COMPACT}
        play="once"
        fill
        accent={ACCENT}
        {...stage}
        theme={theme}
        className={`tgf-stage${className ? ` ${className}` : ''}`}
      />
    </figure>
  )
}

/** The hero: an editor with the file the page is about. */
export function Editor({ file = 'App.tsx', lines, count }: { file?: string; lines: (CodeLine | string)[]; count?: number }) {
  return (
    <Window title={file} className="tgf-editor">
      <Code lines={lines} count={count} className="tgf-code" />
    </Window>
  )
}

/**
 * The satellite: a phone whose screen is the canvas. `children` is SVG content
 * in screen points: 402 wide, 600 tall, starting under the status bar.
 */
export function Device({ children, background, dark }: { children: ReactNode; background?: string; dark?: boolean }) {
  const theme = useDocsTheme()
  const isDark = dark ?? theme === 'dark'
  return (
    <Phone width={236} frame="pro" dark={isDark} wallpaper={background ?? (isDark ? '#0c0c10' : '#ffffff')} className="tgf-phone">
      <svg className="tgf-canvas" viewBox="0 0 402 600" width={402} height={600} aria-hidden="true">
        {children}
      </svg>
    </Phone>
  )
}

/** One code line that can light up as the element it declares draws. */
export function Line({ on, text, children }: { on?: boolean; text?: string; children?: ReactNode }) {
  return (
    <span className="tgf-line" data-on={on || undefined}>
      {children ?? tokens(text ?? '')}
    </span>
  )
}
