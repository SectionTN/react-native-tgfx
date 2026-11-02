'use client'

import { type Act, Roll, tokens } from './kit'
import { Device, Editor, Figure, Line } from './figure'

// Drawing: the code is the cause, the canvas the effect. Beats: the three
// shapes draw in, each as its element lights in the editor; the cursor picks
// the circle's color and it changes; the circle follows. Plays once and holds.
//
// Real strings: the component code and the one value that changes.

type S = { shown: number; active: number; pink: boolean }

const initial: S = { shown: 0, active: -1, pink: false }
const poster: S = { shown: 3, active: 1, pink: true }

async function script(a: Act<S>) {
  await a.wait(600)
  for (let i = 0; i < 3; i++) {
    a.set({ shown: i + 1, active: i })
    await a.wait(700)
  }
  a.set({ active: -1 })
  await a.wait(500)
  await a.click({ at: 'color', x: 0.5, y: 0.5 })
  a.set({ active: 1, pink: true })
  await a.wait(900)
  await a.move({ x: 420, y: 330 })
  await a.wait(2000)
}

export function DrawingFigure() {
  return (
    <Figure<S>
      label="A Canvas with a rounded rect, a circle and a path, drawn on a phone; changing the circle's color in code recolors it on screen."
      initial={initial}
      poster={poster}
      script={script}
      cursor={{ at: { x: 420, y: 330 } }}
    >
      {(s, _rect, layout) => {
        const color = s.pink ? '#ec4899' : '#f59e0b'
        return (
          <>
            <Editor
              lines={[
                "import { Canvas, Circle, Path, RoundedRect } from 'react-native-tgfx'",
                '',
                'export function Shapes() {',
                '  return (',
                '    <Canvas style={{ flex: 1 }}>',
                { text: '', node: <Line on={s.active === 0} text={'      <RoundedRect x={40} y={40} width={150} height={150}'} /> },
                { text: '', node: <Line on={s.active === 0} text={'        r={28} color="#7c3aed" />'} /> },
                { text: '', node: <Line on={s.active === 1} text={'      <Circle cx={290} cy={115} r={75}'} /> },
                {
                  text: '',
                  node: (
                    <Line on={s.active === 1}>
                      {tokens('        color=')}
                      <span className="ss-code__str" data-target="color" data-cursor="ibeam">
                        "<Roll key={layout}>{color}</Roll>"
                      </span>
                      {' />'}
                    </Line>
                  ),
                },
                { text: '', node: <Line on={s.active === 2} text={'      <Path path={wave} style="stroke" strokeWidth={14}'} /> },
                { text: '', node: <Line on={s.active === 2} text={'        color="#0ea5e9" />'} /> },
                '    </Canvas>',
                '  )',
                '}',
              ]}
            />
            <Device>
              <rect className="tgf-shape" data-on={s.shown > 0 || undefined} x={40} y={40} width={150} height={150} rx={28} fill="#7c3aed" />
              <circle className="tgf-shape" data-on={s.shown > 1 || undefined} cx={290} cy={115} r={75} fill={color} style={{ transition: 'fill 0.45s ease, opacity 0.5s, scale 0.6s' }} />
              <path
                className="tgf-shape"
                data-on={s.shown > 2 || undefined}
                d="M40 300 C 100 230, 160 230, 201 300 S 302 370, 362 300"
                fill="none"
                stroke="#0ea5e9"
                strokeWidth={14}
                strokeLinecap="round"
              />
            </Device>
          </>
        )
      }}
    </Figure>
  )
}
