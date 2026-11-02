'use client'

import { type Act, type CodeLine } from './kit'
import { Device, Editor, Figure, Line } from './figure'
import './camera.css'

// Camera frames: VisionCamera frames drawn by tgfx. Beats: the canvas is black
// until the first frame mints the image; <CameraFrame> lights and the lake at
// dusk streams in, the handheld drift saying it is live; the <Shader> block
// lights and the same moving frame turns neon, edges traced in cyan and
// magenta over a dimmed, vignetted image. Plays once and holds, still live.
//
// Real strings: the component code. The frame is the content.

type S = { live: boolean; neon: boolean; lit: 'frame' | 'shader' | null }

const initial: S = { live: false, neon: false, lit: null }
const poster: S = { live: true, neon: true, lit: 'shader' }

async function script(a: Act<S>) {
  await a.wait(700)
  a.set({ live: true, lit: 'frame' })
  a.mark('frames')
  await a.wait(2400)
  a.set({ neon: true, lit: 'shader' })
  a.mark('neon')
  await a.wait(3200)
}

// A landscape at dusk, built the way a lens sees it: ridges stepping back into
// haze, a low sun, a lake taking the sky. The ridgelines are fractal noise from
// a fixed seed, so they read as terrain and are the same on every render.

const X0 = -24
const X1 = 426
const TOP = -90
const BOTTOM = 640

function random(seed: number) {
  let t = seed >>> 0
  return () => {
    t = (t + 0x6d2b79f5) >>> 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

/** A ridgeline: octaves of smoothed value noise, the coarse ones carrying the shape. */
function ridge(base: number, amp: number, seed: number, rough = 0.5) {
  const next = random(seed)
  const octaves = [0, 1, 2, 3, 4].map((o) => {
    const step = 220 / 2 ** o
    const knots = Array.from({ length: Math.ceil((X1 - X0) / step) + 2 }, () => next() * 2 - 1)
    return { step, knots, weight: rough ** o }
  })
  const total = octaves.reduce((sum, o) => sum + o.weight, 0)
  const points: [number, number][] = []
  for (let x = X0; x <= X1; x += 3) {
    let h = 0
    for (const o of octaves) {
      const u = (x - X0) / o.step
      const i = Math.floor(u)
      const f = u - i
      const s = f * f * (3 - 2 * f)
      h += o.weight * (o.knots[i]! * (1 - s) + o.knots[i + 1]! * s)
    }
    points.push([x, base - (h / total) * amp])
  }
  return points
}

const line = (pts: [number, number][]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('')
const area = (pts: [number, number][], floor: number) => `${line(pts)}L${X1} ${floor}L${X0} ${floor}Z`

const SHORE = 262
const FAR = ridge(196, 46, 7, 0.55)
const MID = ridge(226, 40, 23, 0.5)
// The near ridge rises on the left and falls toward the sun
const NEAR = ridge(250, 34, 41, 0.6).map(([x, y]): [number, number] => [x, Math.min(SHORE - 2, y - 22 * Math.max(0, 1 - x / 220))])
const SUN = { x: 268, y: 212, r: 17 }

// The shoreline the lake reflects: the ridges mirrored about the water line
const MIRROR = NEAR.map(([x, y]): [number, number] => [x, 2 * SHORE - y])
const MIRROR_MID = MID.map(([x, y]): [number, number] => [x, 2 * SHORE - y])

// The sun on the water: a column of glints, wide and close near the shore,
// thinning and parting as the water comes toward the lens
const GLINTS = (() => {
  const next = random(11)
  const out: { x: number; y: number; w: number; o: number }[] = []
  for (let y = SHORE + 3, i = 0; y < SHORE + 230; i++) {
    const t = (y - SHORE) / 230
    const w = (6 + 22 * (1 - t)) * (0.55 + next() * 0.7)
    out.push({ x: SUN.x + (next() - 0.5) * (6 + 16 * t) - w / 2, y, w, o: (1 - t) * (0.55 + next() * 0.45) })
    y += 2.2 + t * 6 + next() * 2
  }
  return out
})()

function Glints({ color }: { color?: string }) {
  return (
    <g fill={color ?? '#fff0d0'}>
      {GLINTS.map((g, i) => (
        <rect key={i} x={g.x} y={g.y} width={g.w} height={1.6} rx={0.8} opacity={g.o} />
      ))}
    </g>
  )
}

function Scene() {
  return (
    <g id="tgf-cam-scene">
      {/* Sky: deep blue overhead down to the glow at the horizon */}
      <rect x={X0} y={TOP} width={X1 - X0} height={SHORE - TOP + 4} fill="url(#tgf-cam-sky)" />
      <circle cx={SUN.x} cy={SUN.y} r={190} fill="url(#tgf-cam-glow)" />
      <circle cx={SUN.x} cy={SUN.y} r={SUN.r} fill="#fff4dc" filter="url(#tgf-cam-soft)" />
      {/* Ridges stepping back into haze */}
      <path d={area(FAR, SHORE + 4)} fill="url(#tgf-cam-far)" />
      <rect x={X0} y={196} width={X1 - X0} height={40} fill="url(#tgf-cam-mist)" />
      <path d={area(MID, SHORE + 4)} fill="url(#tgf-cam-mid)" />
      <rect x={X0} y={224} width={X1 - X0} height={36} fill="url(#tgf-cam-mist)" opacity={0.7} />
      <path d={area(MID, SHORE + 4)} filter="url(#tgf-cam-texture)" opacity={0.5} />
      <path d={area(NEAR, SHORE + 4)} fill="url(#tgf-cam-near)" />
      <path d={area(NEAR, SHORE + 4)} filter="url(#tgf-cam-texture)" opacity={0.8} />
      {/* The lake: the sky turned over, the shore and sun in it, broken by ripples */}
      <g filter="url(#tgf-cam-ripple)">
        <rect x={X0} y={SHORE} width={X1 - X0} height={BOTTOM - SHORE} fill="url(#tgf-cam-lake)" />
        <path d={`${line(MIRROR_MID)}L${X1} ${SHORE}L${X0} ${SHORE}Z`} fill="#5a4c74" opacity={0.55} />
        <path d={`${line(MIRROR)}L${X1} ${SHORE}L${X0} ${SHORE}Z`} fill="#211c33" opacity={0.85} />
      </g>
      <rect x={SUN.x - 30} y={SHORE} width={60} height={200} fill="url(#tgf-cam-streak)" opacity={0.35} filter="url(#tgf-cam-defocus)" />
      <g filter="url(#tgf-cam-glint)">
        <Glints />
      </g>
      {/* The near bank, out of focus at the foot of the frame */}
      <path d="M-24 452 C 60 440, 120 470, 210 486 S 360 500, 426 494 L 426 640 L -24 640 Z" fill="#120f1c" filter="url(#tgf-cam-defocus)" />
      <rect x={X0} y={TOP} width={X1 - X0} height={BOTTOM - TOP} filter="url(#tgf-cam-grain)" opacity={0.09} />
    </g>
  )
}

// Where the neon shader finds edges: luma steps the scene really has, each
// tinted by which side is brighter (cyan where the dark side is below, magenta
// where it is above), as NEON's dirEdge mix does
function Edges() {
  return (
    <g fill="none" strokeLinejoin="round" strokeLinecap="round">
      <path d={line(FAR)} stroke="#40fff2" strokeOpacity={0.4} />
      <path d={line(MID)} stroke="#40fff2" strokeOpacity={0.7} />
      <path d={line(NEAR)} stroke="#40fff2" />
      <path d={`M${SUN.x - SUN.r} ${SUN.y} a ${SUN.r} ${SUN.r} 0 0 1 ${2 * SUN.r} 0`} stroke="#ff26e6" />
      <g filter="url(#tgf-cam-ripple)">
        <path d={line(MIRROR)} stroke="#ff26e6" strokeOpacity={0.55} />
        <path d={`M${X0} ${SHORE + 1}H${X1}`} stroke="#b07bff" strokeOpacity={0.5} />
      </g>
      <g stroke="none">
        <Glints color="#ff26e6" />
      </g>
      <path d="M-24 452 C 60 440, 120 470, 210 486 S 360 500, 426 494" stroke="#40fff2" strokeOpacity={0.35} filter="url(#tgf-cam-defocus)" />
    </g>
  )
}

function Defs() {
  return (
    <defs>
      <linearGradient id="tgf-cam-sky" x1={0} y1={TOP} x2={0} y2={SHORE} gradientUnits="userSpaceOnUse">
        <stop offset={0} stopColor="#141a33" />
        <stop offset={0.32} stopColor="#2f3462" />
        <stop offset={0.58} stopColor="#7a5a86" />
        <stop offset={0.8} stopColor="#d98a73" />
        <stop offset={1} stopColor="#f6c08a" />
      </linearGradient>
      <radialGradient id="tgf-cam-glow">
        <stop offset={0} stopColor="#ffe2b0" stopOpacity={0.85} />
        <stop offset={0.25} stopColor="#ffc28a" stopOpacity={0.35} />
        <stop offset={1} stopColor="#ffb07a" stopOpacity={0} />
      </radialGradient>
      <linearGradient id="tgf-cam-far" x1={0} y1={150} x2={0} y2={236} gradientUnits="userSpaceOnUse">
        <stop offset={0} stopColor="#8e7398" />
        <stop offset={1} stopColor="#c08d97" />
      </linearGradient>
      <linearGradient id="tgf-cam-mid" x1={0} y1={186} x2={0} y2={256} gradientUnits="userSpaceOnUse">
        <stop offset={0} stopColor="#56497a" />
        <stop offset={1} stopColor="#7a6585" />
      </linearGradient>
      <linearGradient id="tgf-cam-near" x1={0} y1={200} x2={0} y2={SHORE} gradientUnits="userSpaceOnUse">
        <stop offset={0} stopColor="#231d38" />
        <stop offset={1} stopColor="#2c2540" />
      </linearGradient>
      <linearGradient id="tgf-cam-mist" x1={0} y1={0} x2={0} y2={1}>
        <stop offset={0} stopColor="#f3c4b0" stopOpacity={0} />
        <stop offset={0.7} stopColor="#f3c4b0" stopOpacity={0.32} />
        <stop offset={1} stopColor="#f3c4b0" stopOpacity={0} />
      </linearGradient>
      <linearGradient id="tgf-cam-lake" x1={0} y1={SHORE} x2={0} y2={BOTTOM} gradientUnits="userSpaceOnUse">
        <stop offset={0} stopColor="#d49379" />
        <stop offset={0.18} stopColor="#8a6488" />
        <stop offset={0.5} stopColor="#3a3a68" />
        <stop offset={1} stopColor="#171b33" />
      </linearGradient>
      <linearGradient id="tgf-cam-streak" x1={0} y1={0} x2={0} y2={1}>
        <stop offset={0} stopColor="#fff0cc" stopOpacity={0.95} />
        <stop offset={0.5} stopColor="#ffd09a" stopOpacity={0.45} />
        <stop offset={1} stopColor="#ffc08a" stopOpacity={0} />
      </linearGradient>
      <radialGradient id="tgf-cam-vignette" cx={0.5} cy={0.42} r={0.75}>
        <stop offset={0.55} stopColor="#000" stopOpacity={0} />
        <stop offset={1} stopColor="#000" stopOpacity={0.45} />
      </radialGradient>
      <radialGradient id="tgf-cam-vignette-neon" cx={0.5} cy={0.42} r={0.7}>
        <stop offset={0.35} stopColor="#000" stopOpacity={0} />
        <stop offset={1} stopColor="#000" stopOpacity={0.62} />
      </radialGradient>
      <filter id="tgf-cam-soft" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation={1.6} />
      </filter>
      <filter id="tgf-cam-glint" x="-20%" y="-5%" width="140%" height="110%">
        <feGaussianBlur stdDeviation="0.7 0.4" />
      </filter>
      <filter id="tgf-cam-defocus" x="-10%" y="-20%" width="120%" height="140%">
        <feGaussianBlur stdDeviation={5} />
      </filter>
      {/* Water: stretched horizontal noise pushes the reflection sideways */}
      <filter id="tgf-cam-ripple" x="-5%" y="-5%" width="110%" height="110%">
        <feTurbulence type="fractalNoise" baseFrequency="0.004 0.11" numOctaves={2} seed={3} result="n" />
        <feDisplacementMap in="SourceGraphic" in2="n" scale={14} xChannelSelector="R" yChannelSelector="G" />
        <feGaussianBlur stdDeviation="0.8 0.3" />
      </filter>
      {/* Forest on the slopes: clumped noise, dark, kept inside the ridge */}
      <filter id="tgf-cam-texture" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.035 0.09" numOctaves={3} seed={5} result="n" />
        <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.07  0 0 0 0 0.05  0 0 0 0 0.12  1.6 0 0 0 -0.55" result="t" />
        <feComposite in="t" in2="SourceGraphic" operator="in" />
      </filter>
      <filter id="tgf-cam-grain" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency={0.85} numOctaves={2} seed={9} />
        <feColorMatrix type="saturate" values="0" />
      </filter>
      {/* NEON's base: the frame multiplied by (0.14, 0.09, 0.28) */}
      <filter id="tgf-cam-dim" x="0" y="0" width="100%" height="100%">
        <feColorMatrix type="matrix" values="0.32 0 0 0 0  0 0.2 0 0 0  0 0 0.58 0 0.02  0 0 0 1 0" />
      </filter>
      <filter id="tgf-cam-glowfx" x="-10%" y="-20%" width="120%" height="140%">
        <feGaussianBlur stdDeviation={3} result="b" />
        <feMerge>
          <feMergeNode in="b" />
          <feMergeNode in="b" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  )
}

export function CameraFigure() {
  return (
    <Figure<S>
      label="VisionCamera frames drawn on a tgfx canvas through useCameraFrame and CameraFrame: a lake at dusk streams in, then a NEON shader traces its edges."
      className="tgf-camera"
      initial={initial}
      poster={poster}
      script={script}
    >
      {(s, _rect, layout) => {
        const frame = s.lit === 'frame'
        const shader = s.lit === 'shader'
        // The JSX sits inside the function in the wide listing; compact
        // drops the function and starts at the canvas
        const at = layout === 'compact' ? '' : '    '
        const lit = (on: boolean, text: string): CodeLine => ({ text: '', node: <Line on={on} text={at + text} /> })
        const jsx: (CodeLine | string)[] = [
          lit(frame, '  <CameraFrame image={image} {...posture}>'),
          lit(shader, '    <Fill>'),
          lit(shader, '      <Shader source={NEON}>'),
          lit(shader, '        <ImageShader image={image} />'),
          lit(shader, '      </Shader>'),
          lit(shader, '    </Fill>'),
          `${at}  </CameraFrame>`,
        ]
        const lines: (CodeLine | string)[] =
          layout === 'compact'
            ? ['const { image, posture, onFrame } = useCameraFrame()', '', '<Canvas style={StyleSheet.absoluteFill} opaque>', ...jsx]
            : [
                "import { CameraFrame, Canvas, Fill, ImageShader, Shader, useCameraFrame } from 'react-native-tgfx'",
                '',
                'export function Preview() {',
                '  const { image, posture, onFrame } = useCameraFrame()',
                '  const output = useFrameOutput({ ...OPTIONS, onFrame })',
                "  useCamera({ isActive: true, device: 'back',",
                '    outputs: [output] })',
                '',
                '  return (',
                '    <Canvas style={StyleSheet.absoluteFill} opaque>',
                ...jsx,
              ]
        return (
          <>
            <Editor file="Preview.tsx" lines={lines} />
            <Device background="#000" dark>
              <Defs />
              {/* StyleSheet.absoluteFill: the canvas runs under the status bar */}
              <g className="tgf-camera__frame" data-live={s.live || undefined}>
                <g className="tgf-camera__drift">
                  <Scene />
                  <rect x={X0} y={TOP} width={X1 - X0} height={BOTTOM - TOP} fill="url(#tgf-cam-vignette)" />
                  <g className="tgf-camera__neon" data-on={s.neon || undefined}>
                    <use href="#tgf-cam-scene" filter="url(#tgf-cam-dim)" />
                    <g filter="url(#tgf-cam-glowfx)" strokeWidth={1.6}>
                      <Edges />
                    </g>
                    <rect x={X0} y={TOP} width={X1 - X0} height={BOTTOM - TOP} fill="url(#tgf-cam-vignette-neon)" />
                  </g>
                </g>
              </g>
            </Device>
          </>
        )
      }}
    </Figure>
  )
}
