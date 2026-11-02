'use client'

import { type Act, type CodeLine, Count, tokens } from './kit'
import { Device, Editor, Figure, Line } from './figure'
import './shaders.css'

// Shaders: a runtime SkSL source fills the canvas, then one uniform changes in
// code and the canvas follows. Beats: the <Shader> lights and its gradient
// fills the screen; the cursor picks uRings; 10 rolls to 40 and the soft halo
// tightens into rings, the same pattern at four times the frequency. Plays
// once and holds on the rings.
//
// Real strings: the component code and the one value that changes.

type S = { filled: boolean; lit: 'shader' | 'rings' | null; rings: number }

const initial: S = { filled: false, lit: null, rings: 10 }
const poster: S = { filled: true, lit: 'rings', rings: 40 }

async function script(a: Act<S>) {
  await a.wait(600)
  a.set({ filled: true, lit: 'shader' })
  a.mark('fill')
  await a.wait(1500)
  a.set({ lit: null })
  await a.wait(400)
  await a.click({ at: 'rings', x: 0.5, y: 0.6 })
  a.set({ rings: 40, lit: 'rings' })
  a.mark('rings')
  // Off the value as it rolls, so the figure reads under no I-beam
  await a.move(a.layout === 'compact' ? { x: 250, y: 200 } : { x: 420, y: 330 })
  await a.wait(2600)
}

// The canvas the shader runs on, in screen points, and the uv center its
// rings are measured from
const W = 402
const H = 600
// cos(r * uRings) between 0.6 and 1.0 is drawn as a black wash of 0 to 0.4
// over the gradient: one period of it, sampled finely enough to read smooth
const PERIOD = (2 * Math.PI) / 40
const STOPS = Array.from({ length: 13 }, (_, i) => {
  const t = i / 12
  return { offset: t, alpha: 0.2 * (1 - Math.cos(2 * Math.PI * t)) }
})

export function ShadersFigure() {
  return (
    <Figure<S>
      label="A runtime SkSL shader fills a canvas with a gradient; raising its uRings uniform from 10 to 40 in code turns a soft halo into tight rings."
      className="tgf-shaders"
      initial={initial}
      poster={poster}
      script={script}
      cursor={{ at: { wide: { x: 420, y: 330 }, compact: { x: 250, y: 200 } } }}
    >
      {(s, _rect, layout) => {
        const shader = s.lit === 'shader'
        const value: CodeLine = {
          text: '',
          node: (
            <Line on={shader || s.lit === 'rings'}>
              {tokens('      uRings: ')}
              <span className="ss-code__num" data-target="rings" data-cursor="ibeam">
                <Count key={layout} value={s.rings} />
              </span>
              ,
            </Line>
          ),
        }
        const jsx: (CodeLine | string)[] = [
          '<Canvas style={{ width: 402, height: 600 }}>',
          '  <Fill>',
          { text: '', node: <Line on={shader} text={'    <Shader source={rings} uniforms={{'} /> },
          value,
          { text: '', node: <Line on={shader} text={'      uSize: [402, 600],'} /> },
          { text: '', node: <Line on={shader} text={'    }} />'} /> },
          '  </Fill>',
          '</Canvas>',
        ]
        const lines: (CodeLine | string)[] =
          layout === 'compact'
            ? ["import { Canvas, Fill, Shader } from 'react-native-tgfx'", '', ...jsx]
            : [
                "import { Canvas, Fill, Shader } from 'react-native-tgfx'",
                'const rings = `uniform float2 uSize;',
                'uniform float uRings;',
                'half4 main(float2 pos) {',
                '  float2 uv = pos / uSize;',
                '  float k = 0.8 + 0.2 * cos(length(uv - 0.5) * uRings);',
                '  return half4(half3(uv.x, uv.y * 0.5, 0.9) * k, 1.0);',
                '}`',
                '',
                ...jsx,
              ]
        return (
          <>
            <Editor file="Shader.tsx" lines={lines} />
            <Device>
              <defs>
                <clipPath id="tgf-shaders-clip">
                  <rect x={0} y={0} width={W} height={H} />
                </clipPath>
                {/* uv.x into red, uv.y * 0.5 into green, over a blue of 0.9:
                    the channels never overlap, so screen adds them exactly */}
                <linearGradient id="tgf-shaders-r" x1={0} y1={0} x2={W} y2={0} gradientUnits="userSpaceOnUse">
                  <stop offset={0} stopColor="#000" />
                  <stop offset={1} stopColor="#ff0000" />
                </linearGradient>
                <linearGradient id="tgf-shaders-g" x1={0} y1={0} x2={0} y2={H} gradientUnits="userSpaceOnUse">
                  <stop offset={0} stopColor="#000" />
                  <stop offset={1} stopColor="#008000" />
                </linearGradient>
                {/* The rings in uv space: centered, stretched to the canvas
                    as length(uv - 0.5) is, repeating once per period */}
                <radialGradient
                  id="tgf-shaders-k"
                  gradientUnits="userSpaceOnUse"
                  cx={0}
                  cy={0}
                  r={PERIOD}
                  spreadMethod="repeat"
                  gradientTransform={`translate(${W / 2} ${H / 2}) scale(${W} ${H})`}
                >
                  {STOPS.map((stop) => (
                    <stop key={stop.offset} offset={stop.offset} stopColor="#000" stopOpacity={stop.alpha} />
                  ))}
                </radialGradient>
              </defs>
              <g className="tgf-shaders__fill" data-on={s.filled || undefined} clipPath="url(#tgf-shaders-clip)">
                <rect x={0} y={0} width={W} height={H} fill="#0000e6" />
                <rect className="tgf-shaders__screen" x={0} y={0} width={W} height={H} fill="url(#tgf-shaders-r)" />
                <rect className="tgf-shaders__screen" x={0} y={0} width={W} height={H} fill="url(#tgf-shaders-g)" />
                {/* uRings 10 is this pattern four times larger: the halo
                    tightens into rings as the scale comes down to 1 */}
                <g className="tgf-shaders__rings" style={{ scale: String(40 / s.rings) }}>
                  <rect x={W / 2 - 2 * W} y={H / 2 - 2 * H} width={4 * W} height={4 * H} fill="url(#tgf-shaders-k)" />
                </g>
              </g>
            </Device>
          </>
        )
      }}
    </Figure>
  )
}
