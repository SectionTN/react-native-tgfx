'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { type Act, type CodeLine } from './kit'
import { Device, Editor, Figure, Line } from './figure'
import './text.css'

// Text: a paragraph of three colored spans draws in, span by span, as each
// line lights in the editor; then measureText runs and the box it returns is
// stroked around the paragraph on the phone. The spans differ only in color,
// so one style measures exactly what the spans draw. Plays once and holds on
// the measured box.
//
// Real strings: the code, and the three words the canvas draws.

type S = { spans: number; active: 'text' | 'measure' | 'rect' | null; box: boolean }

const initial: S = { spans: 0, active: null, box: false }
const poster: S = { spans: 3, active: 'rect', box: true }

async function script(a: Act<S>) {
  await a.wait(600)
  a.set({ active: 'text' })
  for (let i = 0; i < 3; i++) {
    a.set({ spans: i + 1 })
    await a.wait(650)
  }
  a.mark('spans')
  a.set({ active: null })
  await a.wait(450)
  a.set({ active: 'measure' })
  a.mark('measure')
  await a.wait(900)
  a.set({ active: 'rect', box: true })
  await a.wait(1300)
  a.mark('box')
  await a.wait(1100)
}

// The paragraph as the canvas lays it out: x 40, first baseline 120, one
// span per line at the width the code gives
const X = 40
const Y = 140
const LEADING = 76
const SPANS = [
  { text: 'Lay out,', color: '#0ea5e9' },
  { text: 'measure,', color: '#ec4899' },
  { text: 'then draw.', color: '#71717a' },
]

function Paragraph({ s }: { s: S }) {
  const ref = useRef<SVGTextElement>(null)
  const [box, setBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null)

  // The box measureText returns: the widest line, from the first line's
  // ascent to the last line's descent. Read from the drawn text itself
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const b = el.getBBox()
      setBox({ x: b.x, y: b.y, width: b.width, height: b.height })
    }
    measure()
    document.fonts?.ready.then(measure)
  }, [])

  return (
    <>
      {box && (
        <rect
          className="tgf-text-box"
          data-on={s.box || undefined}
          x={box.x - 0.75}
          y={box.y - 0.75}
          width={box.width + 1.5}
          height={box.height + 1.5}
          pathLength={1}
          fill="none"
          stroke="#7c3aed"
          strokeWidth={2}
        />
      )}
      <text ref={ref} className="tgf-text-para" x={X} y={Y}>
        {SPANS.map((span, i) => (
          <tspan key={span.text} x={X} y={Y + i * LEADING} fill={span.color} className="tgf-text-span" data-on={s.spans > i || undefined}>
            {span.text}
          </tspan>
        ))}
      </text>
    </>
  )
}

export function TextFigure() {
  return (
    <Figure<S>
      label="A Text of three colored spans drawn on a phone; measureText returns the paragraph's box, stroked around the text."
      className="tgf-text"
      initial={initial}
      poster={poster}
      script={script}
    >
      {(s, _rect, layout) => {
        const compact = layout === 'compact'
        const text = s.active === 'text'
        const measure = s.active === 'measure' || s.active === 'rect'
        const rect = s.active === 'rect'
        const lines: (CodeLine | string)[] = [
          ...(compact ? [] : ["import { Canvas, Rect, Span, Text, measureText } from 'react-native-tgfx'", '']),
          "const words = 'Lay out, measure, then draw.'",
          'const style = { fontSize: 64, width: 340 }',
          { text: '', node: <Line on={measure} text="const box = measureText(words, style)" /> },
          ...(compact ? [] : ['']),
          '<Canvas style={{ flex: 1 }}>',
          { text: '', node: <Line on={rect} text="  <Rect x={40} y={140 + box.ascent}" /> },
          { text: '', node: <Line on={rect} text="    width={box.width} height={box.height}" /> },
          { text: '', node: <Line on={rect} text={'    style="stroke" color="#7c3aed" />'} /> },
          { text: '', node: <Line on={text} text="  <Text {...style} x={40} y={140}>" /> },
          { text: '', node: <Line on={text && s.spans === 1} text={'    <Span text="Lay out, " color="#0ea5e9" />'} /> },
          { text: '', node: <Line on={text && s.spans === 2} text={'    <Span text="measure, " color="#ec4899" />'} /> },
          { text: '', node: <Line on={text && s.spans === 3} text={'    <Span text="then draw." color="#71717a" />'} /> },
          '  </Text>',
          '</Canvas>',
        ]
        return (
          <>
            <Editor lines={lines} />
            <Device>
              <Paragraph s={s} />
            </Device>
          </>
        )
      }}
    </Figure>
  )
}
