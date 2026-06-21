// Generates representative scene JSONs (via the REAL reconciler/compiler) for
// the native engine micro-benchmark, so the benchmark runs on the exact wire
// format the engine consumes. Run via bench/run.sh.
import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { compileScene } from '../src/compiler/compile'
import { NodeType, type Node } from '../src/reconciler/types'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, 'scenes')
mkdirSync(outDir, { recursive: true })

const sv = (v: number) => ({ value: v, _isReanimatedSharedValue: true as const })
const n = (type: unknown, props: object, ch: Node[] = []): Node =>
  ({ type, props, children: ch }) as Node

// HEAVY: 120-dot phyllotaxis spiral — the worst-case static/procedural scene.
const heavy: Node[] = []
const golden = Math.PI * (3 - Math.sqrt(5))
for (let i = 0; i < 120; i++) {
  const a = i * golden
  const rr = 7 * Math.sqrt(i)
  heavy.push(
    n(NodeType.Circle, {
      cx: 80 + rr * Math.cos(a),
      cy: 110 + rr * Math.sin(a),
      r: 3.5,
      color: `hsl(${(i * 7) % 360},75%,55%)`,
    })
  )
}

// ANIMATED: the 4-shape animated section (SharedValue slots + transform ops).
const r = sv(20)
const ang = sv(0.5)
const cy = sv(60)
const sc = sv(1)
const animated: Node[] = [
  n(NodeType.Circle, { cx: 55, cy: 60, r, color: '#FF3B30' }),
  n(NodeType.Group, { transform: [{ rotate: ang }], origin: { x: 150, y: 60 } }, [
    n(NodeType.RoundedRect, { x: 126, y: 36, width: 48, height: 48, r: 10, color: '#5856D6' }),
  ]),
  n(NodeType.Circle, { cx: 245, cy, r: 15, color: '#34C759' }),
  n(NodeType.Group, { transform: [{ scale: sc }], origin: { x: 335, y: 60 } }, [
    n(NodeType.Path, { path: 'M335 34 L341 52 L360 52 L345 64 Z', color: '#FF9500' }),
  ]),
]

// FULL: a representative mixed scene (shapes, strokes, gradient, path, text).
const full: Node[] = [
  n(NodeType.Rect, { x: 0, y: 0, width: 80, height: 56, color: '#4F8EF7' }),
  n(NodeType.RoundedRect, { x: 96, y: 0, width: 80, height: 56, r: 14, color: '#34C759' }),
  n(NodeType.Circle, { cx: 216, cy: 28, r: 28, color: '#FF9500' }),
  n(NodeType.Oval, { x: 256, y: 0, width: 92, height: 56, color: '#AF52DE' }),
  n(NodeType.Circle, { cx: 28, cy: 28, r: 24, color: '#FF3B30', style: 'stroke', strokeWidth: 6 }),
  n(NodeType.Line, { x1: 176, y1: 6, x2: 250, y2: 52, color: '#1C1C1E', style: 'stroke', strokeWidth: 8, strokeCap: 'round' }),
  n(NodeType.Path, { path: 'M262 50 q24 -52 48 0 t48 0', color: '#5856D6', style: 'stroke', strokeWidth: 5 }),
  n(NodeType.RoundedRect, { x: 0, y: 0, width: 170, height: 64, r: 16 }, [
    n(NodeType.LinearGradient, { start: { x: 0, y: 0 }, end: { x: 170, y: 64 }, colors: ['#FF6CAB', '#7366FF'] }),
  ]),
  n(NodeType.Text, { x: 0, y: 26, text: 'Shapes Strokes Image Text', fontSize: 20, color: '#111' }),
  n(NodeType.Group, { transform: [{ translateX: 16 }, { rotate: '8deg' }] }, [
    n(NodeType.Rect, { x: 0, y: 0, width: 40, height: 40, color: 'red' }),
  ]),
]

for (const [name, roots] of [
  ['heavy', heavy],
  ['animated', animated],
  ['full', full],
] as const) {
  const { json, values } = compileScene(roots)
  writeFileSync(join(outDir, `${name}.json`), json)
  console.log(`${name}: ${json.length} bytes, ${values.length} animated values`)
}
