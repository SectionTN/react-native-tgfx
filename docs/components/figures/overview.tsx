'use client'

import type { Act } from './kit'
import { Device, Editor, Figure, Line } from './figure'
import './overview.css'

// Overview: one canvas, built from a few declarative pieces. Beats: the
// gradient card lands as its RoundedRect and LinearGradient light; a soft
// glow blooms as the blurred Circle lights; the title fades in as its Text
// lights; hold on the finished card.
//
// Real strings: the component code and "Hello, tgfx".

type S = { step: number }

const initial: S = { step: 0 }
const poster: S = { step: 3 }

async function script(a: Act<S>) {
  await a.wait(600)
  for (let step = 1; step <= 3; step++) {
    a.set({ step })
    await a.wait(1100)
  }
  await a.wait(1800)
}

export function OverviewFigure() {
  return (
    <Figure<S>
      className="tgf-ov"
      label="A Canvas built from a gradient RoundedRect, a blurred Circle and a Text, drawn on a phone piece by piece as each element's code lights up."
      initial={initial}
      poster={poster}
      script={script}
    >
      {(s, _rect, layout) => {
        const compact = layout === 'compact'
        const lit = (step: number) => s.step === step
        return (
          <>
            <Editor
              lines={[
                ...(compact
                  ? []
                  : ["import { Blur, Canvas, Circle, LinearGradient, RoundedRect, Text } from 'react-native-tgfx'", 'export const App = () => (']),
                '  <Canvas style={{ flex: 1 }}>',
                { text: '', node: <Line on={lit(1)} text={'    <RoundedRect x={24} y={24} width={354}'} /> },
                { text: '', node: <Line on={lit(1)} text={'      height={360} r={32}>'} /> },
                { text: '', node: <Line on={lit(1)} text={"      <LinearGradient colors={GRAPE}"} /> },
                { text: '', node: <Line on={lit(1)} text={'        start={TOP} end={BOTTOM} />'} /> },
                { text: '', node: <Line on={lit(1)} text={'    </RoundedRect>'} /> },
                { text: '', node: <Line on={lit(2)} text={'    <Circle cx={292} cy={296} r={64}'} /> },
                { text: '', node: <Line on={lit(2)} text={'      color="#fde68a">'} /> },
                { text: '', node: <Line on={lit(2)} text={'      <Blur blur={28} />'} /> },
                { text: '', node: <Line on={lit(2)} text={'    </Circle>'} /> },
                { text: '', node: <Line on={lit(3)} text={'    <Text text="Hello, tgfx" x={52}'} /> },
                { text: '', node: <Line on={lit(3)} text={'      y={104} fontSize={44} color="#fff" />'} /> },
                '  </Canvas>',
                ...(compact ? [] : [')']),
              ]}
            />
            <Device>
              <defs>
                <linearGradient id="tgf-ov-grape" x1="24" y1="24" x2="378" y2="384" gradientUnits="userSpaceOnUse">
                  <stop offset="0" stopColor="#6d28d9" />
                  <stop offset="1" stopColor="#ec4899" />
                </linearGradient>
                <filter id="tgf-ov-blur" x="-80%" y="-80%" width="260%" height="260%">
                  <feGaussianBlur stdDeviation="28" />
                </filter>
                <clipPath id="tgf-ov-card">
                  <rect x={24} y={24} width={354} height={360} rx={32} />
                </clipPath>
              </defs>
              <rect className="tgf-shape" data-on={s.step >= 1 || undefined} x={24} y={24} width={354} height={360} rx={32} fill="url(#tgf-ov-grape)" />
              <g clipPath="url(#tgf-ov-card)">
                <circle className="tgf-shape" data-on={s.step >= 2 || undefined} cx={292} cy={296} r={64} fill="#fde68a" filter="url(#tgf-ov-blur)" />
              </g>
              <text
                className="tgf-shape"
                data-on={s.step >= 3 || undefined}
                x={52}
                y={104}
                fontSize={44}
                fontWeight={600}
                letterSpacing={-1}
                fill="#fff"
                style={{ fontFamily: 'var(--font-sans), system-ui, sans-serif' }}
              >
                Hello, tgfx
              </text>
            </Device>
          </>
        )
      }}
    </Figure>
  )
}
