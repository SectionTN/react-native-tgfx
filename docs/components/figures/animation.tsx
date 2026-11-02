'use client'

import { type Act, Badge, Count } from './kit'
import { Device, Editor, Figure, Line, useDocsTheme } from './figure'
import './animation.css'

// Animation: the shared value is animated on the thread that paints, so the
// canvas keeps moving while JS is stuck. Beats: the withRepeat line lights and
// the circle starts pulsing; the sortAll line lights and the JS thread's frame
// rate rolls to 0 with a busy badge; the circle never misses a beat; hold.
//
// Real strings: the component code, the two thread names, their frame rates
// and "busy".

type S = { pulsing: boolean; lit: number; busy: boolean }

const initial: S = { pulsing: false, lit: -1, busy: false }
const poster: S = { pulsing: true, lit: 1, busy: true }

async function script(a: Act<S>) {
  await a.wait(700)
  a.set({ lit: 0, pulsing: true })
  await a.wait(2600)
  a.set({ lit: 1 })
  await a.wait(300)
  a.set({ busy: true })
  await a.wait(4000)
}

const fps = (n: number) => `${n} fps`

export function AnimationFigure() {
  const theme = useDocsTheme()
  return (
    <Figure<S>
      className="tgf-anim"
      label="A circle whose radius is a Reanimated shared value keeps pulsing on the phone while a long sort blocks the JS thread: the JS thread drops to 0 fps, the UI thread stays at 60."
      initial={initial}
      poster={poster}
      script={script}
    >
      {(s) => (
        <>
          <Editor
            lines={[
              "import { useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'",
              "import { Canvas, Circle } from 'react-native-tgfx'",
              '',
              'export function Pulse({ rows }) {',
              '  const r = useSharedValue(48)',
              '  useEffect(() => {',
              '    const grow = withTiming(96, { duration: 800 })',
              { text: '', node: <Line on={s.lit === 0} text={'    r.value = withRepeat(grow, -1, true)'} /> },
              { text: '', node: <Line on={s.lit === 1} text={'    sortAll(rows) // blocks the JS thread'} /> },
              '  }, [rows])',
              '',
              '  return (',
              '    <Canvas style={{ flex: 1 }}>',
              '      <Circle cx={201} cy={236} r={r}',
              '        color="#7c3aed" />',
              '    </Canvas>',
              '  )',
              '}',
            ]}
          />
          <Device>
            <circle className="tgf-anim__pulse" data-on={s.pulsing || undefined} cx={201} cy={236} r={96} fill="#7c3aed" />
            <foreignObject x={20} y={16} width={362} height={112}>
              <div className="tgf-anim__perf" data-theme={theme} data-busy={s.busy || undefined}>
                <div className="tgf-anim__row">
                  <span className="tgf-anim__dot" />
                  <span className="tgf-anim__name">UI thread</span>
                  <Count className="tgf-anim__fps" value={60} format={fps} />
                </div>
                <div className="tgf-anim__row" data-js>
                  <span className="tgf-anim__dot" />
                  <span className="tgf-anim__name">JS thread</span>
                  <Badge tone="warning" className="tgf-anim__busy">
                    busy
                  </Badge>
                  <Count className="tgf-anim__fps" value={s.busy ? 0 : 60} format={fps} duration={900} />
                </div>
              </div>
            </foreignObject>
          </Device>
        </>
      )}
    </Figure>
  )
}
