import { expect, mock, test } from 'bun:test'

// No runOnJS/makeMutable, so handles keep the JS push path — but a recording
// startMapper lets the tests drive the scene's UI-thread mapper by hand.
const mappers = new Map<number, () => void>()
let nextMapper = 1
mock.module('react-native-reanimated', () => ({
  startMapper: (worklet: () => void) => {
    const id = nextMapper++
    mappers.set(id, worklet)
    return id
  },
  stopMapper: (id: number) => {
    mappers.delete(id)
  },
}))
import { beforeEach } from 'bun:test'
import { circle, rect, text } from './elements'
import { createHandle } from './imperative'
import { Scene, type SceneTarget } from './scene'

beforeEach(() => {
  mappers.clear()
})

function target() {
  const calls = {
    scenes: [] as { words: number[]; strings: string[] }[],
    values: [] as number[][],
    stringValues: [] as { indices: number[]; values: string[] }[],
  }
  const t: SceneTarget = {
    setScene: (buffer, strings) => {
      const words = new Float64Array(buffer)
      calls.scenes.push({
        words: Array.from(words.subarray(0, words[1])),
        strings: strings.slice(),
      })
    },
    setValues: (values) => calls.values.push(values.slice()),
    setStringValues: (indices, values) =>
      calls.stringValues.push({
        indices: indices.slice(),
        values: values.slice(),
      }),
  }
  return { t, calls }
}

const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve))

test('mutations in one tick batch into a single commit', async () => {
  const { t, calls } = target()
  const scene = Scene.create()
  scene.attach(t)
  for (let i = 0; i < 100; i++) {
    scene.add(circle({ cx: i, cy: 0, r: 1 }))
  }
  scene.insert(rect({ x: 0, y: 0, width: 1, height: 1 }), 0)
  expect(calls.scenes.length).toBe(0)
  await tick()
  expect(calls.scenes.length).toBe(1)
  expect(calls.scenes[0]!.words[3]).toBe(101) // root count
})

test('flush commits now and the stale microtask stays quiet', async () => {
  const { t, calls } = target()
  const scene = Scene.create()
  scene.attach(t)
  scene.add(rect({ x: 0, y: 0, width: 1, height: 1 }))
  scene.flush()
  expect(calls.scenes.length).toBe(1)
  await tick()
  expect(calls.scenes.length).toBe(1)
})

test('remove works by identity and clear empties the scene', async () => {
  const { t, calls } = target()
  const scene = Scene.create()
  scene.attach(t)
  const badge = rect({ x: 8, y: 8, width: 4, height: 2 })
  scene.add(badge)
  scene.add(circle({ cx: 1, cy: 1, r: 1 }))
  expect(scene.remove(badge)).toBe(true)
  expect(scene.remove(badge)).toBe(false)
  scene.flush()
  expect(calls.scenes[0]!.words[3]).toBe(1)
  scene.clear()
  scene.flush()
  expect(calls.scenes[1]!.words[3]).toBe(0)
})

test('a handle write patches slots without a re-encode', async () => {
  const { t, calls } = target()
  const scene = Scene.create()
  scene.attach(t)
  const box = createHandle()
  scene.add(rect({ ref: box, x: 0, y: 0, width: 4, height: 4 }))
  scene.flush()
  expect(calls.scenes.length).toBe(1)
  box.set({ x: 120, y: 60 })
  expect(calls.scenes.length).toBe(1) // no new program
  expect(calls.values.length).toBe(1)
  const last = calls.values[0]!
  expect(last).toContain(120)
  expect(last).toContain(60)
})

test('each target keeps its own delta string table', () => {
  const a = target()
  const b = target()
  const scene = Scene.create()
  scene.attach(a.t)
  scene.add(text({ x: 0, y: 10, text: 'day 1' }))
  scene.flush()
  expect(a.calls.scenes[0]!.strings[0]).toBe('0') // full table for a fresh target
  const sentToA = a.calls.scenes[0]!.strings.length

  scene.attach(b.t) // recompiles: b gets the full table, a a kept-prefix delta
  expect(b.calls.scenes[0]!.strings[0]).toBe('0')
  expect(b.calls.scenes[0]!.strings.length).toBe(sentToA)
  const deltaToA = a.calls.scenes[1]!.strings
  expect(Number(deltaToA[0])).toBeGreaterThan(0)
  expect(deltaToA.length).toBeLessThan(sentToA)
})

test('detach stops fan-out to that target only', () => {
  const a = target()
  const b = target()
  const scene = Scene.create()
  const detachA = scene.attach(a.t)
  scene.attach(b.t)
  scene.add(rect({ x: 0, y: 0, width: 1, height: 1 }))
  scene.flush()
  detachA()
  scene.add(rect({ x: 2, y: 0, width: 1, height: 1 }))
  scene.flush()
  expect(a.calls.scenes.length).toBe(1)
  expect(b.calls.scenes.length).toBe(2)
})

test('attaching to a compiled scene replays the current program', () => {
  const scene = Scene.create()
  scene.add(rect({ x: 0, y: 0, width: 1, height: 1 }))
  scene.flush()
  const { t, calls } = target()
  scene.attach(t)
  expect(calls.scenes.length).toBe(1)
  expect(calls.scenes[0]!.words[3]).toBe(1)
})

test('dispose stops commits and detaches every target', async () => {
  const { t, calls } = target()
  const scene = Scene.create()
  scene.attach(t)
  scene.add(rect({ x: 0, y: 0, width: 1, height: 1 }))
  scene.dispose()
  await tick()
  scene.flush()
  expect(calls.scenes.length).toBe(0)
})

test('a scene runs its own mapper so handle writes land without a driver', () => {
  const { t, calls } = target()
  const scene = Scene.create()
  const detach = scene.attach(t)
  const box = createHandle()
  scene.add(rect({ ref: box, x: 0, y: 0, width: 4, height: 4 }))
  scene.flush()
  expect(mappers.size).toBe(1)
  // The mapper is AnimationDriver's: run it as Reanimated would on a change.
  const run = [...mappers.values()][0]!
  const before = calls.values.length
  run()
  expect(calls.values.length).toBe(before + 1)
  detach()
  expect(mappers.size).toBe(0) // no targets left, nothing to push to
})

test('dispose stops the mapper', () => {
  const { t } = target()
  const scene = Scene.create()
  scene.attach(t)
  const box = createHandle()
  scene.add(rect({ ref: box, x: 0, y: 0, width: 4, height: 4 }))
  scene.flush()
  expect(mappers.size).toBe(1)
  scene.dispose()
  expect(mappers.size).toBe(0)
})

test('Scene.from seeds the roots and commits on the microtask', async () => {
  const { t, calls } = target()
  const scene = Scene.from([
    rect({ x: 0, y: 0, width: 1, height: 1 }),
    circle({ cx: 1, cy: 1, r: 1 }),
  ])
  scene.attach(t)
  expect(calls.scenes.length).toBe(1) // attach flushes the pending commit
  expect(calls.scenes[0]!.words[3]).toBe(2)
})

test('handlesAt names the nodes behind a flat hit answer', () => {
  const { t } = target()
  const scene = Scene.create()
  scene.attach(t)
  const box = createHandle()
  scene.add(rect({ ref: box, x: 0, y: 0, width: 4, height: 4 }))
  scene.add(circle({ cx: 8, cy: 8, r: 2 }))
  scene.flush()
  // The wire shape view/surface hitTest returns: [depth, i0, ...] topmost first.
  expect(scene.handlesAt([1, 0])).toEqual([box])
  expect(scene.handlesAt([1, 1])).toEqual([null])
  expect(scene.handlesAt([1, 1, 1, 0])).toEqual([null, box])
  expect(scene.handlesAt([])).toEqual([])
})

test('a structural commit does not snap handle writes back to factory props', () => {
  const { t, calls } = target()
  const scene = Scene.create()
  scene.attach(t)
  const box = createHandle()
  scene.add(rect({ ref: box, x: 0, y: 0, width: 4, height: 4 }))
  scene.flush()
  box.set({ x: 120 })

  scene.add(circle({ cx: 1, cy: 1, r: 1 }))
  scene.flush()
  const program = calls.scenes[calls.scenes.length - 1]!.words
  // Header(3) rootCount kind, then x — the write must survive the re-encode.
  expect(program[5]).toBe(120)
})

test('attach after dispose throws instead of registering on a muted scene', () => {
  const scene = Scene.create()
  scene.dispose()
  const { t } = target()
  expect(() => scene.attach(t)).toThrow('disposed')
})

test('an export-only recompile stays quiet: no re-send, no mapper restart', () => {
  const { t, calls } = target()
  const scene = Scene.create()
  scene.attach(t)
  const box = createHandle()
  scene.add(rect({ ref: box, x: 0, y: 0, width: 4, height: 4 }))
  scene.flush()
  expect(calls.scenes.length).toBe(1)
  const mapperBefore = nextMapper

  const first = scene.compileForExport('test')
  expect(new Float64Array(first.buffer)[3]).toBe(1)
  expect(calls.scenes.length).toBe(1) // nothing re-sent to the target
  expect(nextMapper).toBe(mapperBefore) // mapper untouched

  // A genuinely dirty export is a real commit and does fan out.
  scene.add(circle({ cx: 1, cy: 1, r: 1 }))
  scene.compileForExport('test')
  expect(calls.scenes.length).toBe(2)
})
