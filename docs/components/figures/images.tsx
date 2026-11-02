'use client'

import { useId } from 'react'
import { type Act, Count, tokens } from './kit'
import { Device, Editor, Figure, Line } from './figure'
import './images.css'

// Images: one photo, drawn twice. Beats: useImage resolves and the photo
// draws full width with fit="cover"; a second TgfxImage draws only the `crop`
// sub-rect of the same decoded image under it; the cursor edits crop.x and the
// crop pans across the photo to the sun as the value rolls. Plays once, holds.
//
// Real strings: the component code and the one value that changes.

type S = { active: number; shown: number; x: number }

const initial: S = { active: -1, shown: 0, x: 120 }
const poster: S = { active: 2, shown: 2, x: 830 }

/** The photo's pixel size: what `rect` is measured in. */
const PHOTO = { width: 1600, height: 900 }
/** The crop's source rect size and where it draws, in screen points. */
const CROP = { y: 340, width: 600, height: 300 }
const DEST = { x: 0, y: 212, width: 402, height: 200 }

async function script(a: Act<S>) {
  await a.wait(300)
  a.set({ active: 0 })
  await a.wait(600)
  a.set({ active: 1, shown: 1 })
  await a.wait(900)
  a.set({ active: 3, shown: 2 })
  await a.wait(1000)
  a.set({ active: -1 })
  await a.wait(400)
  await a.click({ at: 'crop-x', x: 1.2, y: 0.7 })
  a.set({ active: 2, x: 830 })
  await a.wait(1000)
  await a.move({ x: 420, y: 330 })
  await a.wait(2000)
}

export function ImagesFigure() {
  return (
    <Figure<S>
      label="A photo loaded with useImage and drawn on a phone with fit cover; a second image draws a sub-rect of it, and changing the rect's x in code pans the crop to the sun."
      className="tgf-images"
      initial={initial}
      poster={poster}
      script={script}
      cursor={{ at: { x: 420, y: 330 } }}
    >
      {(s, _rect, layout) => (
        <>
          <Editor
            lines={[
              "import { Canvas, TgfxImage, useImage } from 'react-native-tgfx'",
              '',
              'export function Sea() {',
              { text: '', node: <Line on={s.active === 0} text={"  const photo = useImage(require('./sea.jpg'))"} /> },
              {
                text: '',
                node: (
                  <Line on={s.active === 2 || s.active === 3}>
                    {tokens('  const crop = { x: ')}
                    <span className="tgf-images__value" data-target="crop-x" data-cursor="ibeam">
                      <Count key={layout} value={s.x} />
                    </span>
                    {tokens(`, y: ${CROP.y},`)}
                  </Line>
                ),
              },
              { text: '', node: <Line on={s.active === 2 || s.active === 3} text={`    width: ${CROP.width}, height: ${CROP.height} }`} /> },
              '  return (',
              '    <Canvas style={{ flex: 1 }}>',
              { text: '', node: <Line on={s.active === 1} text={'      <TgfxImage image={photo} fit="cover"'} /> },
              { text: '', node: <Line on={s.active === 1} text={'        x={0} y={0} width={402} height={200}'} /> },
              { text: '', node: <Line on={s.active === 1} text={'      />'} /> },
              { text: '', node: <Line on={s.active === 3} text={'      <TgfxImage image={photo} rect={crop}'} /> },
              { text: '', node: <Line on={s.active === 3} text={`        x={0} y={${DEST.y}} width={${DEST.width}} height={${DEST.height}}`} /> },
              { text: '', node: <Line on={s.active === 3} text={'      />'} /> },
              '    </Canvas>',
              '  )',
              '}',
            ]}
          />
          <Device>
            <Photo shown={s.shown} x={s.x} />
          </Device>
        </>
      )}
    </Figure>
  )
}

/** The canvas: the full photo with cover, and the crop drawn from its sub-rect. */
function Photo({ shown, x }: { shown: number; x: number }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '')
  const scene = `tgf-sea-${id}`
  // The crop's scale: source pixels to screen points (the rect and the
  // destination share an aspect, so contain fits it exactly)
  const k = DEST.width / CROP.width
  return (
    <>
      <g className="tgf-shape" data-on={shown > 0 || undefined}>
      <svg
        x={0}
        y={0}
        width={402}
        height={200}
        viewBox={`0 0 ${PHOTO.width} ${PHOTO.height}`}
        preserveAspectRatio="xMidYMid slice"
      >
        <SeaScene id={scene} />
      </svg>
      </g>
      <g className="tgf-shape" data-on={shown > 1 || undefined}>
      <svg
        x={DEST.x}
        y={DEST.y}
        width={DEST.width}
        height={DEST.height}
        viewBox={`0 0 ${DEST.width} ${DEST.height}`}
      >
        <g className="tgf-images__pan" style={{ transform: `scale(${k}) translate(${-x}px, ${-CROP.y}px)` }}>
          <use href={`#${scene}`} />
        </g>
      </svg>
      </g>
    </>
  )
}

/** Seeded so the server and client draw the same water. */
function seeded(seed: number) {
  let t = seed
  return () => {
    t = (t * 1664525 + 1013904223) % 4294967296
    return t / 4294967296
  }
}

const SUN = { x: 1130, y: 486, r: 44 }
const HORIZON = 540

// Glints on the water under the sun: thin horizontal strokes, wider and
// sparser toward the viewer
const GLINTS = (() => {
  const rnd = seeded(7)
  const out: { x: number; y: number; w: number; o: number }[] = []
  for (let i = 0; i < 140; i++) {
    const d = rnd()
    const y = HORIZON + 3 + d * d * 330
    const spread = 24 + (y - HORIZON) * 0.5
    // Gaussian-ish: most glints near the column's middle
    const off = (rnd() + rnd() + rnd() - 1.5) / 1.5
    out.push({ x: SUN.x + off * spread, y, w: 10 + rnd() * (22 + (y - HORIZON) * 0.3), o: (0.75 - d * 0.55) * (1 - Math.abs(off) * 0.6) })
  }
  return out
})()

/**
 * A dusk seascape at 1600 × 900 "pixels": a sky running from indigo to a
 * low amber glow, a setting sun with its glow, lit cloud bands, ridges hazing
 * into the distance, and water carrying the light back. Grain and a vignette
 * keep it reading as a photograph, not a vector drawing.
 */
function SeaScene({ id }: { id: string }) {
  const u = (name: string) => `${id}-${name}`
  const url = (name: string) => `url(#${u(name)})`
  return (
    <>
      <defs>
        <linearGradient id={u('sky')} x1="0" y1="0" x2="0" y2={HORIZON} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#1b2049" />
          <stop offset="0.32" stopColor="#3f3a74" />
          <stop offset="0.58" stopColor="#a1607f" />
          <stop offset="0.8" stopColor="#ec9a62" />
          <stop offset="1" stopColor="#ffd08e" />
        </linearGradient>
        <radialGradient id={u('glow')} cx={SUN.x} cy={SUN.y} r="620" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff3d2" stopOpacity="0.95" />
          <stop offset="0.12" stopColor="#ffd08a" stopOpacity="0.7" />
          <stop offset="0.45" stopColor="#f29a6a" stopOpacity="0.22" />
          <stop offset="1" stopColor="#f29a6a" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={u('water')} x1="0" y1={HORIZON} x2="0" y2="900" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#e39a6c" />
          <stop offset="0.18" stopColor="#9a6081" />
          <stop offset="0.55" stopColor="#47355f" />
          <stop offset="1" stopColor="#191932" />
        </linearGradient>
        <radialGradient id={u('waterglow')} cx={SUN.x} cy={HORIZON} r="520" gradientTransform={`translate(${SUN.x} ${HORIZON}) scale(0.55 1) translate(${-SUN.x} ${-HORIZON})`} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffcf8a" stopOpacity="0.75" />
          <stop offset="0.5" stopColor="#f0956a" stopOpacity="0.2" />
          <stop offset="1" stopColor="#f0956a" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={u('far')} x1="0" y1="360" x2="0" y2={HORIZON} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#8d5f8c" />
          <stop offset="1" stopColor="#c98b8e" />
        </linearGradient>
        <linearGradient id={u('mid')} x1="0" y1="420" x2="0" y2={HORIZON} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#5a3d6c" />
          <stop offset="1" stopColor="#7a5076" />
        </linearGradient>
        <radialGradient id={u('vignette')} cx="800" cy="470" r="980" gradientUnits="userSpaceOnUse">
          <stop offset="0.55" stopColor="#0b0a1c" stopOpacity="0" />
          <stop offset="1" stopColor="#0b0a1c" stopOpacity="0.55" />
        </radialGradient>
        <filter id={u('soft')} x="-20%" y="-200%" width="140%" height="500%">
          <feGaussianBlur stdDeviation="16" />
        </filter>
        <filter id={u('haze')} x="-5%" y="-20%" width="110%" height="140%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
        <filter id={u('glint')} x="-20%" y="-300%" width="140%" height="700%">
          <feGaussianBlur stdDeviation="3.5 1.4" />
        </filter>
        <filter id={u('rough')} x="-2%" y="-10%" width="104%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.02 0.09" numOctaves="3" seed="11" />
          <feDisplacementMap in="SourceGraphic" scale="14" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id={u('grain')} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="4" />
          <feColorMatrix values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0.9 0" />
        </filter>
      </defs>
      <g id={id}>
        <rect width="1600" height={HORIZON + 2} fill={url('sky')} />
        <rect width="1600" height={HORIZON + 2} fill={url('glow')} />

        {/* Cloud bands, lit from below near the sun */}
        <g filter={url('soft')}>
          <ellipse cx="380" cy="150" rx="460" ry="26" fill="#2b2a5c" opacity="0.35" />
          <ellipse cx="980" cy="230" rx="520" ry="22" fill="#6a4677" opacity="0.6" />
          <ellipse cx="1260" cy="318" rx="330" ry="14" fill="#ffb27f" opacity="0.75" />
          <ellipse cx="520" cy="330" rx="380" ry="16" fill="#d07f86" opacity="0.55" />
          <ellipse cx="1420" cy="400" rx="200" ry="9" fill="#ffd2a0" opacity="0.7" />
        </g>

        {/* The sun, a little soft through the haze */}
        <circle cx={SUN.x} cy={SUN.y} r={SUN.r + 22} fill="#ffe3ad" opacity="0.5" filter={url('soft')} />
        <circle cx={SUN.x} cy={SUN.y} r={SUN.r} fill="#fff4dc" filter={url('haze')} />

        {/* Ridges: the farthest palest, each nearer one darker */}
        <path
          d="M0 392 C 70 380, 130 352, 210 360 S 330 402, 400 388 S 520 336, 600 350 S 720 410, 820 432 S 960 476, 1040 502 C 1090 520, 1140 534, 1210 541 L 1210 542 L 0 542 Z"
          fill={url('far')}
          filter={url('haze')}
        />
        <path d="M1250 541 C 1320 530, 1390 512, 1460 512 S 1560 520, 1600 517 L 1600 542 L 1250 542 Z" fill="#b97b8b" opacity="0.85" filter={url('haze')} />
        <g filter={url('rough')}>
        <path
          d="M0 448 C 60 430, 120 418, 190 428 S 300 470, 360 462 S 470 432, 540 452 S 650 510, 760 530 L 820 542 L 0 542 Z"
          fill={url('mid')}
        />
        <path d="M0 492 C 80 478, 150 470, 230 486 S 360 524, 470 536 L 520 542 L 0 542 Z" fill="#2c2142" />
        </g>

        {/* Water */}
        <rect y={HORIZON} width="1600" height={900 - HORIZON} fill={url('water')} />
        <rect y={HORIZON} width="1600" height={900 - HORIZON} fill={url('waterglow')} />
        {/* The headland's reflection, darker and broken */}
        <path d="M0 542 L 520 542 C 440 548, 330 556, 220 560 S 60 570, 0 574 Z" fill="#241c3a" opacity="0.7" filter={url('haze')} />
        <path d="M0 574 C 120 568, 300 560, 520 552 L 760 546 C 600 560, 380 578, 0 600 Z" fill="#4a3360" opacity="0.35" filter={url('haze')} />
        <ellipse cx={SUN.x} cy={HORIZON + 150} rx="70" ry="160" fill="#ffd9a0" opacity="0.18" filter={url('soft')} />
        <g filter={url('glint')}>
          {GLINTS.map((g, i) => (
            <rect key={i} x={g.x - g.w / 2} y={g.y} width={g.w} height={1.5 + (g.y - HORIZON) / 110} rx="1" fill="#ffe2ad" opacity={g.o} />
          ))}
        </g>
        <rect x="0" y={HORIZON - 1} width="1600" height="3" fill="#ffd9a0" opacity="0.35" filter={url('haze')} />

        <rect width="1600" height="900" fill={url('vignette')} />
        <rect width="1600" height="900" filter={url('grain')} opacity="0.14" style={{ mixBlendMode: 'overlay' }} />
      </g>
    </>
  )
}
