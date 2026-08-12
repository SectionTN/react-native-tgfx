'use client'

import { useEffect, useRef, useState } from 'react'
import { Spider } from './spider'

type Phase = 'idle' | 'cover' | 'reveal' | 'park'

/**
 * Plays once per document load: a spider hangs on its silk at centre screen,
 * resolves into the Margelo mark, and parks in the corner. Client-side
 * navigation never replays it, so moving between pages leaves the mark alone.
 */
export function DrawTransition() {
  const [phase, setPhase] = useState<Phase>('idle')
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  const clearTimers = () => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }

  // Only a running transition may reveal, so a stray call cannot drop the
  // curtain back over the page once it has parked.
  const reveal = () => setPhase((prev) => (prev === 'cover' ? 'reveal' : prev))
  const park = () => setPhase('park')

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setPhase('park')
      return
    }

    setPhase('cover')

    // Backgrounding the tab pauses the animation, so `animationend` may never
    // arrive. Nothing here may leave a full-screen curtain over the page.
    timers.current.push(setTimeout(reveal, 2900), setTimeout(park, 3600))
    return clearTimers
  }, [])

  if (phase === 'idle') return null

  return (
    <>
      {/* The curtain and its silk clear; the mark is a sibling so it does not. */}
      {phase !== 'park' && (
        <div
          className="tg-draw"
          data-phase={phase}
          aria-hidden="true"
          onAnimationEnd={(event) => {
            if (event.animationName !== 'tg-draw-reveal') return
            clearTimers()
            park()
          }}
        >
          <span className="tg-draw-silk" />
        </div>
      )}
      <span
        className="tg-draw-mark"
        data-phase={phase}
        aria-hidden="true"
        onAnimationEnd={(event) => {
          // The mark reaching the corner is the last thing to finish, so it is
          // what the reveal waits on.
          if (event.animationName !== 'tg-draw-mark-park') return
          reveal()
        }}
      >
        {/* Morphs on the way in; once parked it is a still image, loop and all. */}
        {phase === 'park' ? (
          <Spider variant="themed" morph={1} className="tg-hero-canvas" />
        ) : (
          <Spider variant="themed" morphMs={820} morphDelayMs={200} className="tg-hero-canvas" />
        )}
      </span>
    </>
  )
}
