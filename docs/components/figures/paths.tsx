'use client'

import { type Act, bezier, Count, type CodeLine, tokens } from './kit'
import { Device, Editor, Figure, Line } from './figure'
import './paths.css'

// Paths: the code is the cause, the canvas the effect. Beats: the stroke's
// trim `end` rolls 0 to 1 in code while the path draws on the phone; then the
// fraction handed to pathPointAtLength rolls 0 to 0.64 and the circle placed
// at that point travels along the route. Plays once and holds with the marker
// partway along the drawn path.
//
// Real strings: the code and the two values that change.

type S = { end: number; along: number; active: 'path' | 'marker' | null; marker: boolean }

const ROUTE = 'M40 300 C 130 -20, 270 420, 362 70'
const AT = 0.64

const initial: S = { end: 0, along: 0, active: null, marker: false }
const poster: S = { end: 1, along: AT, active: 'marker', marker: true }

// Both values step through the same curve their canvas transitions run on,
// so the figure in code and the drawing on the phone stay together
const DRAW = 1800
const STEPS = 7
const EASE = [0.45, 0, 0.2, 1] as const
const ease = bezier(EASE)

async function roll(a: Act<S>, key: 'end' | 'along', to: number) {
  for (let i = 1; i <= STEPS; i++) {
    a.set({ [key]: Math.round(ease(i / STEPS) * to * 100) / 100 } as Partial<S>)
    await a.wait(DRAW / STEPS)
  }
}

async function script(a: Act<S>) {
  await a.wait(600)
  a.set({ active: 'path' })
  await a.wait(250)
  a.mark('drawing')
  await roll(a, 'end', 1)
  a.mark('drawn')
  await a.wait(500)
  a.set({ active: 'marker', marker: true })
  await a.wait(450)
  a.mark('along')
  await roll(a, 'along', AT)
  a.mark('placed')
  await a.wait(2400)
}

const fixed = (n: number) => n.toFixed(2)

export function PathsFigure() {
  return (
    <Figure<S>
      label="A stroked path drawn on a phone as its end trim rolls from 0 to 1 in code; then a circle placed with pathPointAtLength travels along it."
      className="tgf-paths"
      initial={initial}
      poster={poster}
      script={script}
    >
      {(s, _rect, layout) => {
        const compact = layout === 'compact'
        const path = s.active === 'path'
        const marker = s.active === 'marker'
        const lines: (CodeLine | string)[] = [
          ...(compact ? [] : ["import { Canvas, Circle, Path, pathLength, pathPointAtLength } from 'react-native-tgfx'", '']),
          `const route = '${ROUTE}'`,
          { text: '', node: <Line on={marker} text="const at = pathPointAtLength(route," /> },
          {
            text: '',
            node: (
              <Line on={marker}>
                {tokens('  pathLength(route) * ')}
                <span className="ss-code__num">
                  <Count key={layout} value={s.along} format={fixed} duration={140} stagger={10} />
                </span>
                {')'}
              </Line>
            ),
          },
          ...(compact ? [] : ['']),
          '<Canvas style={{ flex: 1 }}>',
          { text: '', node: <Line on={path} text={'  <Path path={route} style="stroke"'} /> },
          { text: '', node: <Line on={path} text={'    strokeWidth={12} color="#0ea5e9"'} /> },
          {
            text: '',
            node: (
              <Line on={path}>
                {tokens('    end={')}
                <span className="ss-code__num">
                  <Count key={layout} value={s.end} format={fixed} duration={140} stagger={10} />
                </span>
                {'} />'}
              </Line>
            ),
          },
          { text: '', node: <Line on={marker} text="  <Circle cx={at.x} cy={at.y} r={16}" /> },
          { text: '', node: <Line on={marker} text={'    color="#7c3aed" />'} /> },
          '</Canvas>',
        ]
        return (
          <>
            <Editor lines={lines} />
            <Device>
              <path
                className="tgf-paths-route"
                d={ROUTE}
                pathLength={1}
                fill="none"
                stroke="#0ea5e9"
                strokeWidth={12}
                strokeLinecap="round"
                style={{ strokeDasharray: `${s.end} 2`, opacity: s.end > 0 ? 1 : 0 }}
              />
              <g className="tgf-paths-marker" data-on={s.marker || undefined} style={{ offsetPath: `path('${ROUTE}')`, offsetDistance: `${s.along * 100}%` }}>
                <circle cx={0} cy={0} r={16} fill="#7c3aed" />
              </g>
            </Device>
          </>
        )
      }}
    </Figure>
  )
}
