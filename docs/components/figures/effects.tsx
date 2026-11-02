'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { type Act, clock, Roll, tokens, useReducedMotion } from './kit'
import { Device, Editor, Figure, Line, useDocsTheme } from './figure'
import './effects.css'

// Effects: a backdrop reads what is drawn under it. Beats: two circles are on
// the canvas; a BackdropBlur and a tinted RoundedRect with a DropShadow lay a
// clear card over them; the cursor edits blur and, as 0 rolls to 24, the
// circles under the card frost in step. Plays once and holds.
//
// Real strings: the component code and the one value that changes.

type S = { active: number; card: boolean; blur: number }

const initial: S = { active: -1, card: false, blur: 0 }
const poster: S = { active: 1, card: true, blur: 24 }

const CARD = { x: 36, y: 190, width: 330, height: 170, r: 28 }

async function script(a: Act<S>) {
  await a.wait(700)
  a.set({ active: 0, card: true })
  await a.wait(1400)
  a.set({ active: -1 })
  await a.wait(400)
  await a.click({ at: 'blur', x: 0.95, y: 0.95 })
  a.set({ active: 1, blur: 24 })
  await a.wait(1100)
  await a.move({ x: 420, y: 330 })
  await a.wait(2000)
}

export function EffectsFigure() {
  return (
    <Figure<S>
      label="Two circles on a phone canvas under a card drawn with BackdropBlur, a translucent RoundedRect and a DropShadow; raising blur in code frosts the circles under the card."
      className="tgf-effects"
      initial={initial}
      poster={poster}
      script={script}
      cursor={{ at: { x: 420, y: 330 } }}
    >
      {(s, _rect, layout) => (
        <>
          <Editor
            lines={[
              "import { BackdropBlur, Canvas, Circle, DropShadow, RoundedRect } from 'react-native-tgfx'",
              '',
              'export const Frosted = () => (',
              '  <Canvas style={{ flex: 1 }}>',
              '    <Circle cx={118} cy={128} r={88} color="#f59e0b" />',
              '    <Circle cx={292} cy={236} r={100} color="#ec4899" />',
              '    <Circle cx={96} cy={352} r={60} color="#0ea5e9" />',
              { text: '', node: <Line on={s.active >= 0} text={'    <BackdropBlur x={36} y={190} r={28}'} /> },
              {
                text: '',
                node: (
                  <Line on={s.active >= 0}>
                    {tokens('      width={330} height={170} blur={')}
                    <span className="tgf-effects__value" data-target="blur" data-cursor="ibeam">
                      <Roll key={layout}>{String(s.blur)}</Roll>
                    </span>
                    {'} />'}
                  </Line>
                ),
              },
              { text: '', node: <Line on={s.active === 0} text={'    <RoundedRect x={36} y={190} r={28}'} /> },
              { text: '', node: <Line on={s.active === 0} text={'      width={330} height={170}'} /> },
              { text: '', node: <Line on={s.active === 0} text={'      color="rgba(255,255,255,0.3)">'} /> },
              { text: '', node: <Line on={s.active === 0} text={'      <DropShadow dy={16} blur={32}'} /> },
              { text: '', node: <Line on={s.active === 0} text={'        color="#00000040" />'} /> },
              { text: '', node: <Line on={s.active === 0} text={'    </RoundedRect>'} /> },
              '  </Canvas>',
              ')',
            ]}
          />
          <Device>
            <Frosted card={s.card} blur={s.blur} />
          </Device>
        </>
      )}
    </Figure>
  )
}

/** A value eased toward its target on the stage clock: the frost follows the code. */
function useEased(target: number, duration = 900) {
  const reduced = useReducedMotion()
  const [value, setValue] = useState(target)
  const from = useRef(target)
  useEffect(() => {
    if (reduced) {
      from.current = target
      setValue(target)
      return
    }
    const start = clock.now()
    const begin = from.current
    let id = 0
    const tick = () => {
      const t = Math.min(1, (clock.now() - start) / duration)
      // The travel curve, close enough to cubic-bezier(0.45, 0, 0.1, 1)
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
      const v = begin + (target - begin) * e
      from.current = v
      setValue(v)
      if (t < 1) id = clock.raf(tick)
    }
    id = clock.raf(tick)
    return () => clock.cancelRaf(id)
  }, [target, duration, reduced])
  return value
}

function Circles() {
  return (
    <>
      <circle cx={118} cy={128} r={88} fill="#f59e0b" />
      <circle cx={292} cy={236} r={100} fill="#ec4899" />
      <circle cx={96} cy={352} r={60} fill="#0ea5e9" />
    </>
  )
}

/** The canvas: the circles, the backdrop blurred inside the card, the tint and its shadow. */
function Frosted({ card, blur }: { card: boolean; blur: number }) {
  const theme = useDocsTheme()
  const ground = theme === 'dark' ? '#0c0c10' : '#ffffff'
  const id = useId().replace(/[^a-zA-Z0-9]/g, '')
  const eased = useEased(blur)
  const { x, y, width, height, r } = CARD
  return (
    <>
      <defs>
        <clipPath id={`${id}-card`}>
          <rect x={x} y={y} width={width} height={height} rx={r} />
        </clipPath>
        <filter id={`${id}-frost`} x={-60} y={-60} width={522} height={540} filterUnits="userSpaceOnUse">
          <feGaussianBlur stdDeviation={eased / 2} />
        </filter>
        <filter id={`${id}-shadow`} x={-60} y={-60} width={522} height={540} filterUnits="userSpaceOnUse">
          <feGaussianBlur stdDeviation={16} />
        </filter>
      </defs>
      <Circles />
      <g className="tgf-shape tgf-effects__card" data-on={card || undefined}>
        <rect x={x} y={y + 16} width={width} height={height} rx={r} fill="#000" opacity={0.25} filter={`url(#${id}-shadow)`} />
        <g clipPath={`url(#${id}-card)`}>
          <rect x={x} y={y} width={width} height={height} fill={ground} />
          <g filter={eased > 0.01 ? `url(#${id}-frost)` : undefined}>
            <Circles />
          </g>
        </g>
        <rect x={x} y={y} width={width} height={height} rx={r} fill="#ffffff" fillOpacity={0.3} />
      </g>
    </>
  )
}
