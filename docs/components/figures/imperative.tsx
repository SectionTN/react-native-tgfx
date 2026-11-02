'use client'

import { type Act, type Point, type Rect } from './kit'
import { Device, Editor, Figure, Line } from './figure'
import './imperative.css'

// Imperative: a gesture worklet writes straight into two node handles. Beats:
// the ball hangs on its cord; a finger presses it and the two set() lines
// light; the drag carries the ball and the cord's end with the finger, every
// frame a slot write, no render; the finger lifts and the ball stays where it
// was put, the JSX still saying where it started.
//
// Real strings: the component code.

const REST: Point = { x: 201, y: 170 }
const DROP: Point = { x: 120, y: 278 }
const R = 44

type S = { ball: Point; lit: boolean }

const initial: S = { ball: REST, lit: false }
const poster: S = { ball: DROP, lit: true }

/** A stage point as a point on the canvas, in screen points. */
const toCanvas = (at: Point, screen: Rect): Point => ({
  x: ((at.x - screen.x) / screen.width) * 402,
  y: ((at.y - screen.y) / screen.height) * 600,
})

const toStage = (p: Point, screen: Rect): Point => ({
  x: screen.x + (p.x / 402) * screen.width,
  y: screen.y + (p.y / 600) * screen.height,
})

async function script(a: Act<S>) {
  await a.wait(900)
  const screen = a.rect('screen')
  await a.move(toStage(REST, screen))
  a.set({ lit: true })
  // One swing out and down, slowing into the spot the finger leaves it
  const via = toStage({ x: 56, y: 170 }, screen)
  await a.drag(
    toStage(DROP, screen),
    (at) => a.set({ ball: toCanvas(at, screen) }),
    {
      duration: 1700,
      path: (p, from, to) => {
        const t = 1 - (1 - p) * (1 - p)
        const u = 1 - t
        return {
          x: u * u * from.x + 2 * u * t * via.x + t * t * to.x,
          y: u * u * from.y + 2 * u * t * via.y + t * t * to.y,
        }
      },
    },
  )
  await a.wait(2600)
}

export function ImperativeFigure() {
  return (
    <Figure<S>
      className="tgf-imp"
      label="A finger drags a ball on a cord across the phone; the pan gesture's worklet writes the ball's and the cord's positions into their node handles with set(), with no React render."
      initial={initial}
      poster={poster}
      script={script}
      cursor={{ at: { x: 640, y: 300 }, style: 'touch' }}
    >
      {(s) => (
        <>
          <Editor
            lines={[
              "import { Canvas, Circle, Line, useNode } from 'react-native-tgfx'",
              '',
              'export function Tether() {',
              '  const ball = useNode()',
              '  const cord = useNode()',
              '  const pan = Gesture.Pan().onUpdate((e) => {',
              "    'worklet'",
              { text: '', node: <Line on={s.lit} text={'    ball.set({ cx: e.x, cy: e.y })'} /> },
              { text: '', node: <Line on={s.lit} text={'    cord.set({ x2: e.x, y2: e.y })'} /> },
              '  })',
              '',
              '  return (',
              '    <GestureDetector gesture={pan}>',
              '      <Canvas style={{ flex: 1 }}>',
              '        <Line ref={cord} x1={201} y1={0}',
              `          x2={201} y2={${REST.y}} strokeWidth={4}`,
              '          color="#a1a1aa" />',
              `        <Circle ref={ball} cx={201} cy={${REST.y}}`,
              `          r={${R}} color="#7c3aed" />`,
              '      </Canvas>',
              '    </GestureDetector>',
              '  )',
              '}',
            ]}
          />
          <Device>
            <rect data-target="screen" x={0} y={0} width={402} height={600} fill="none" />
            <line
              className="tgf-imp__cord"
              x1={201}
              y1={0}
              x2={s.ball.x}
              y2={s.ball.y}
              stroke="#a1a1aa"
              strokeWidth={4}
              strokeLinecap="round"
            />
            <circle className="tgf-imp__ball" cx={s.ball.x} cy={s.ball.y} r={R} fill="#7c3aed" />
          </Device>
        </>
      )}
    </Figure>
  )
}
