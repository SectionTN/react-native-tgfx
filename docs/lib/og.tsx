import { ImageResponse } from 'next/og'

export const size = { width: 1200, height: 630 }

const GROUND = '#0d1017'
const LINE = '#232a36'
const INK = '#e6eaf2'
const MUTED = '#8b93a5'
const JS = '#d98a4a'
const NATIVE = '#6aa9ff'
const MARK = 'M0 13.2353L0 0.827206L14.1176 12.3529L10 4.13603L15 0V13.2353H0Z'

function Lane({ label, color, frames, dim }: { label: string; color: string; frames: number[]; dim: number[] }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
      <div style={{ width: 120, fontSize: 22, color, letterSpacing: 1 }}>{label}</div>
      <div style={{ display: 'flex', gap: 8 }}>
        {frames.map((w, i) => (
          <div
            key={i}
            style={{ width: w, height: 28, borderRadius: 6, background: color, opacity: dim.includes(i) ? 0.22 : 0.9 }}
          />
        ))}
      </div>
    </div>
  )
}

export function renderOg({
  crumbs = ['docs'],
  title = 'react-native-tgfx',
  description = 'A declarative GPU 2D canvas for React Native. Animate on the thread that paints.',
}: { crumbs?: string[]; title?: string; description?: string } = {}) {
  const blurb = description.length > 150 ? `${description.slice(0, 147).trimEnd()}…` : description
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 72,
          background: GROUND,
          backgroundImage: `radial-gradient(circle at 85% 20%, rgba(106,169,255,0.18), transparent 45%), radial-gradient(circle at 10% 95%, rgba(217,138,74,0.14), transparent 40%)`,
          color: INK,
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            right: -40,
            bottom: -150,
            fontSize: 460,
            fontWeight: 800,
            letterSpacing: -24,
            color: '#151a23',
          }}
        >
          tgfx
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 26, color: MUTED }}>
          <svg width="30" height="28" viewBox="0 0 15 14">
            <path d={MARK} fill={INK} />
          </svg>
          <span>margelo</span>
          {crumbs.flatMap((c, i) => [
            <span key={`s${i}`} style={{ color: LINE }}>/</span>,
            <span key={c + i}>{c}</span>,
          ])}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ fontSize: title.length > 24 ? 64 : 84, letterSpacing: -3, lineHeight: 1.05 }}>{title}</div>
          <div style={{ fontSize: 34, color: MUTED, maxWidth: 820, lineHeight: 1.3 }}>
            {blurb}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Lane label="JS" color={JS} frames={[90, 40, 150, 60]} dim={[1, 3]} />
          <Lane label="native" color={NATIVE} frames={[56, 56, 56, 56, 56, 56, 56, 56, 56, 56]} dim={[]} />
        </div>
      </div>
    ),
    size
  )
}
