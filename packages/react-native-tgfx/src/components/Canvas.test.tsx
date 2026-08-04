import { beforeEach, expect, mock, test } from 'bun:test'
import React, { StrictMode, useEffect, useLayoutEffect, useState } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { nativeMocks } from '../testing/nativeMocks'
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

// Scene word layout is [VERSION, wordCount, patchTableStart, rootNodeCount, ...].
let scenes: number[][] = []
let pushed: number[][] = []
let invalidated = 0

function FakeView({ hybridRef }: { hybridRef: (ref: unknown) => void }): null {
  useEffect(() => {
    hybridRef({
      setScene: (buffer: ArrayBuffer) => {
        const words = new Float64Array(buffer)
        scenes.push(Array.from(words.subarray(0, words[1])))
      },
      setValues: (values: number[]) => pushed.push(values.slice()),
      invalidate: () => invalidated++,
    })
  }, [hybridRef])
  return null
}

mock.module('react-native-reanimated', () => ({
  startMapper: () => 0,
  stopMapper: () => {},
  makeMutable: (value: number) => ({
    value,
    _isReanimatedSharedValue: true,
  }),
}))
nativeMocks.hostComponent = FakeView as never

// Synchronous: a top-level await lets another test file's mock.module land first.
const { Canvas } = require('./Canvas') as typeof import('./Canvas')
const { Rect, Path, Text } =
  require('./drawings') as typeof import('./drawings')

function Star(): React.ReactElement {
  return <Path path="M0 0L1 1" color="gold" />
}

function Toggle({ custom }: { custom: boolean }): React.ReactElement {
  return (
    <Canvas>
      <Rect x={0} y={0} width={10} height={10} color="red" />
      {custom ? <Star /> : null}
    </Canvas>
  )
}

const rootCounts = () => scenes.map((words) => words[3])

const SCENE = (
  <Canvas>
    <Rect x={0} y={0} width={10} height={10} color="red" />
  </Canvas>
)

async function render(
  element: React.ReactElement
): Promise<TestRenderer.ReactTestRenderer> {
  let tree!: TestRenderer.ReactTestRenderer
  await act(async () => {
    tree = TestRenderer.create(element)
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
  return tree
}

beforeEach(() => {
  scenes = []
  pushed = []
  invalidated = 0
})

// StrictMode re-runs effects on remount but not the render body that builds the root.
test('a static scene reaches the native view after a StrictMode remount', async () => {
  await render(SCENE)
  const plain = scenes.at(-1)
  expect(plain?.[3]).toBe(1)

  scenes = []
  await render(<StrictMode>{SCENE}</StrictMode>)

  expect(scenes.at(-1)).toEqual(plain!)
})

test('switching from the fallback path back to the direct one keeps the scene', async () => {
  const tree = await render(<Toggle custom />)
  expect(scenes.at(-1)![3]).toBe(2)

  scenes = []
  await act(async () => {
    tree.update(<Toggle custom={false} />)
    await new Promise((resolve) => setTimeout(resolve, 50))
  })

  expect(scenes.at(-1)![3]).toBe(1)
  expect(rootCounts()).not.toContain(0)
})

test('the paths keep swapping without losing the scene', async () => {
  const tree = await render(<Toggle custom />)
  for (const custom of [false, true, false]) {
    await act(async () => {
      tree.update(<Toggle custom={custom} />)
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(scenes.at(-1)![3]).toBe(custom ? 2 : 1)
  }
  expect(rootCounts()).not.toContain(0)
})

test('unmounting still tears the root down', async () => {
  const tree = await render(SCENE)
  expect(scenes.at(-1)![3]).toBe(1)

  await act(async () => {
    tree.unmount()
    await new Promise((resolve) => setTimeout(resolve, 20))
  })

  expect(scenes.at(-1)![3]).toBe(0)
})

// ---- Imperative node handles ----

// A single <Rect> starts at word 4: [kind, x, y, width, height, ...paint].
const X = 5
const { useNode } = require('../imperative') as typeof import('../imperative')

type NodeHandleLike = ReturnType<typeof useNode>
let box!: NodeHandleLike
let rerender!: () => void

function Handled(): React.ReactElement {
  const [, setTick] = useState(0)
  box = useNode()
  rerender = () => setTick((t) => t + 1)
  return (
    <Canvas>
      <Rect ref={box} x={0} y={0} width={10} height={10} color="red" />
    </Canvas>
  )
}

test('a written prop reaches the engine without a React render or a re-encode', async () => {
  await render(<Handled />)
  expect(scenes.at(-1)![X]).toBe(0)
  scenes = []

  await act(async () => box.set({ x: 120 }))

  // Slots exist for every patchable prop the element carries, so even the first
  // write is a value patch.
  expect(scenes).toEqual([])
  expect(pushed).toEqual([[120, 0, 10, 10]])
})

test('writing a slotted prop again still patches values', async () => {
  await render(<Handled />)
  scenes = []
  await act(async () => box.set({ x: 200 }))
  await act(async () => box.set({ x: 240 }))

  expect(scenes).toEqual([])
  expect(pushed.map((values) => values[0])).toEqual([200, 240])
})

test('a prop with no slot re-encodes every write', async () => {
  await render(<Handled />)
  scenes = []

  await act(async () => box.set({ path: 'M0 0L1 1' }))
  await act(async () => box.set({ path: 'M0 0L2 2' }))

  expect(scenes.length).toBe(2)
  expect(pushed).toEqual([])
})

// Colour costs four slots and a per-frame paint rebuild, so the first write
// buys them and every one after it is a patch — the `opacity` bargain.
test('colour re-encodes once, then patches', async () => {
  await render(<Handled />)
  scenes = []

  await act(async () => box.set({ color: '#ff00ff' }))
  expect(scenes.length).toBe(1)
  pushed = []

  await act(async () => box.set({ color: '#00ff00' }))

  expect(scenes.length).toBe(1)
  // [x, y, width, height, r, g, b, a] — green, opaque.
  expect(pushed).toEqual([[0, 0, 10, 10, 0, 1, 0, 1]])
})

test('a packed colour is patchable from a worklet', async () => {
  await render(<Handled />)
  await act(async () => box.set({ color: '#ff00ff' }))
  scenes = []
  const globals = globalThis as { _WORKLET?: boolean }
  globals._WORKLET = true
  try {
    await act(async () => box.set({ color: 0xff0000ff }))
  } finally {
    delete globals._WORKLET
  }

  await act(async () => box.set({ x: 1 }))
  expect(scenes).toEqual([])
  expect(pushed.at(-1)).toEqual([1, 0, 10, 10, 0, 0, 1, 1])
})

test('a write from a worklet patches the slot and never touches JS', async () => {
  await render(<Handled />)
  scenes = []
  const globals = globalThis as { _WORKLET?: boolean }
  globals._WORKLET = true
  try {
    await act(async () => box.set({ x: 180 }))
  } finally {
    delete globals._WORKLET
  }

  // On the UI thread the write itself wakes the driver's mapper, so nothing is
  // pushed from here and nothing is re-encoded.
  expect(scenes).toEqual([])
  expect(pushed).toEqual([])
  await act(async () => box.set({ y: 5 }))
  expect(pushed).toEqual([[180, 5, 10, 10]])
})

test('the next React commit takes the node back', async () => {
  await render(<Handled />)
  await act(async () => box.set({ x: 120 }))
  expect(pushed.at(-1)![0]).toBe(120)

  await act(async () => {
    rerender()
    await new Promise((resolve) => setTimeout(resolve, 20))
  })

  expect(scenes.at(-1)![X]).toBe(0)
})

test('redraw() forces a frame without a commit', async () => {
  const canvas = React.createRef<import('../types').CanvasHandle>()
  await render(<Canvas ref={canvas}>{SCENE.props.children}</Canvas>)
  scenes = []

  canvas.current!.redraw()

  expect(invalidated).toBe(1)
  expect(scenes).toEqual([])
})

// The reconciler path attaches the ref itself, which must not disturb it.
function Boxed({ handle }: { handle: NodeHandleLike }): React.ReactElement {
  return <Rect ref={handle} x={0} y={0} width={10} height={10} color="red" />
}

function BoxedScene(): React.ReactElement {
  box = useNode()
  return (
    <Canvas>
      <Boxed handle={box} />
    </Canvas>
  )
}

test('a handle works through the reconciler path too', async () => {
  await render(<BoxedScene />)
  scenes = []

  await act(async () => box.set({ x: 90 }))

  expect(scenes).toEqual([])
  expect(pushed).toEqual([[90, 0, 10, 10]])
})

// `Text`'s wrap width is patchable-looking but the compiler writes it as a
// literal, so an override is not proof of a slot: every write has to re-encode.
function Labelled(): React.ReactElement {
  box = useNode()
  return (
    <Canvas>
      <Text ref={box} x={0} y={10} text="hi" width={100} />
    </Canvas>
  )
}

test('a slot-shaped prop the compiler writes as a literal re-encodes every time', async () => {
  await render(<Labelled />)
  scenes = []

  await act(async () => box.set({ width: 200 }))
  await act(async () => box.set({ width: 300 }))

  expect(scenes.length).toBe(2)
  // [kind, x, y, textIndex, fontSize, ...font, width]
  expect(scenes.at(-1)!).toContain(300)
})

function Toggled({ show }: { show: boolean }): React.ReactElement {
  box = useNode()
  return (
    <Canvas>
      {show ? (
        <Rect ref={box} x={0} y={0} width={10} height={10} color="red" />
      ) : null}
    </Canvas>
  )
}

test('a write made while the node is unmounted does not outlive its remount', async () => {
  const tree = await render(<Toggled show />)
  await act(async () => {
    tree.update(<Toggled show={false} />)
    await new Promise((resolve) => setTimeout(resolve, 20))
  })

  await act(async () => box.set({ color: '#00ff00' }))
  scenes = []
  await act(async () => {
    tree.update(<Toggled show />)
    await new Promise((resolve) => setTimeout(resolve, 20))
  })

  // 0xFFFF0000: the JSX red, not the green written while it was gone.
  expect(scenes.at(-1)!).toContain(4294901760)
})

// A layout effect runs before the passive effect the canvas compiles in, so
// this write happens while the handle has no program behind it yet.
function EarlyWrite(): React.ReactElement {
  box = useNode()
  useLayoutEffect(() => {
    box.set({ color: '#00ff00' })
  }, [])
  return (
    <Canvas>
      <Rect ref={box} x={0} y={0} width={10} height={10} color="red" />
    </Canvas>
  )
}

test('a write made before the first compile survives it', async () => {
  await render(<EarlyWrite />)

  expect(scenes.at(-1)!).toContain(4278255360)
})

// ---- Transform operands and shader uniforms ----

const { Group } = require('./Group') as typeof import('./Group')
const { Fill } = require('./drawings') as typeof import('./drawings')
const { Shader } = require('./Paint') as typeof import('./Paint')

function Spun(): React.ReactElement {
  box = useNode()
  return (
    <Canvas>
      <Group ref={box} transform={[{ rotate: 0 }]}>
        <Rect x={0} y={0} width={10} height={10} color="red" />
      </Group>
    </Canvas>
  )
}

test('a transform operand re-encodes once, then patches', async () => {
  await render(<Spun />)
  scenes = []

  await act(async () => box.set({ rotate: 1 }))
  expect(scenes.length).toBe(1)
  pushed = []

  await act(async () => box.set({ rotate: 2 }))

  expect(scenes.length).toBe(1)
  expect(pushed).toEqual([[2]])
})

// A `ref` alone must not make the matrix live: one slot in a group's ops costs
// it a matrix rebuild on every frame.
test('an unwritten transform stays folded into a literal matrix', async () => {
  await render(<Spun />)

  await act(async () => box.set({ x: 5 }))

  expect(pushed).toEqual([])
})

function Scaled(): React.ReactElement {
  box = useNode()
  return (
    <Canvas>
      <Group ref={box}>
        <Rect x={0} y={0} width={10} height={10} color="red" />
      </Group>
    </Canvas>
  )
}

test('an operand the group does not declare is appended', async () => {
  await render(<Scaled />)
  scenes = []

  await act(async () => box.set({ scale: 3 }))
  await act(async () => box.set({ scale: 4 }))

  expect(scenes.length).toBe(1)
  // One SharedValue behind both axes of the scale op, so one slot.
  expect(pushed).toEqual([[4]])
})

const SOURCE = `
uniform float2 uCenter;
uniform float uRadius;
half4 main(float2 pos) {
  return half4(half(length(pos - uCenter) / uRadius), 0.0, 0.0, 1.0);
}
`

function Shaded(): React.ReactElement {
  box = useNode()
  return (
    <Canvas>
      <Fill>
        <Shader
          ref={box}
          source={SOURCE}
          uniforms={{ uCenter: [0, 0], uRadius: 1 }}
        />
      </Fill>
    </Canvas>
  )
}

// A `ref` on a <Shader> has one job, so its uniforms are live from the first
// compile: even the first write is a patch.
test('shader uniforms are slot-patched, never re-encoded', async () => {
  await render(<Shaded />)
  scenes = []

  await act(async () => box.set({ uniforms: { uCenter: [4, 5] } }))
  await act(async () => box.set({ uniforms: { uCenter: [6, 7], uRadius: 8 } }))

  expect(scenes).toEqual([])
  expect(pushed).toEqual([
    [4, 5, 1],
    [6, 7, 8],
  ])
})

test('a uniform write from a worklet never touches JS', async () => {
  await render(<Shaded />)
  scenes = []
  const globals = globalThis as { _WORKLET?: boolean }
  globals._WORKLET = true
  try {
    await act(async () => box.set({ uniforms: { uRadius: 9 } }))
  } finally {
    delete globals._WORKLET
  }

  await act(async () => box.set({ uniforms: { uCenter: [1, 2] } }))
  expect(scenes).toEqual([])
  expect(pushed.at(-1)).toEqual([1, 2, 9])
})

// ---- Regressions from the branch review ----

const sv = (value: number) => ({
  value,
  _isReanimatedSharedValue: true as const,
})

const TWO = `
uniform float uA;
uniform float uB;
half4 main(float2 pos) { return half4(half(uA), half(uB), 0.0, 1.0); }
`

let caller!: { value: number }

function CallerUniform(): React.ReactElement {
  box = useNode()
  return (
    <Canvas>
      <Fill>
        <Shader ref={box} source={TWO} uniforms={{ uA: caller, uB: 5 }} />
      </Fill>
    </Canvas>
  )
}

// A ref exists to make *some* uniform patchable; it must not quietly take over
// one the caller is already animating, which would leave it driven by nothing.
test("a ref does not evict a caller's own SharedValue uniform", async () => {
  caller = sv(0.9)
  await render(<CallerUniform />)

  await act(async () => box.set({ uniforms: { uB: 7 } }))
  expect(pushed.at(-1)).toEqual([0.9, 7])

  caller.value = 0.5
  await act(async () => box.set({ uniforms: { uB: 8 } }))

  // 0.5, not 0: the caller's value still reaches the engine.
  expect(pushed.at(-1)).toEqual([0.5, 8])
})

const VEC = `
uniform float2 uA;
uniform float uB;
half4 main(float2 pos) { return half4(half(uA.x), half(uA.y), half(uB), 1.0); }
`

function WidenedUniform(): React.ReactElement {
  box = useNode()
  return (
    <Canvas>
      <Fill>
        <Shader ref={box} source={VEC} uniforms={{ uA: 1, uB: 3 }} />
      </Fill>
    </Canvas>
  )
}

// Widening one uniform shifts every later one's base. The recompile that hands
// over the wider run does not reseed from the JSX, so without carrying the
// values across, the write is lost and the neighbour reads a stale offset.
test('widening a uniform keeps its own write and its neighbour', async () => {
  await render(<WidenedUniform />)
  scenes = []

  await act(async () => box.set({ uniforms: { uA: [7, 8] } }))

  const words = scenes.at(-1)!
  expect(words).toContain(7)
  expect(words).toContain(8)
  // uB still 3, not 0 and not uA's leftover.
  expect(words).toContain(3)
})

test('an animated colour channel is unwrapped, not stored as NaN', async () => {
  await render(<Handled />)
  const red = sv(1)

  // First write opts colour in and seeds through the parser; the second takes
  // the worklet fast path, which is where the unwrap was missing.
  await act(async () => box.set({ color: [red, 0, 0, 1] }))
  await act(async () => box.set({ color: [red, 0, 0, 1] }))

  expect(pushed.at(-1)!.every(Number.isFinite)).toBe(true)
  expect(pushed.at(-1)!.slice(4)).toEqual([1, 0, 0, 1])
})

function Untransformable(): React.ReactElement {
  box = useNode()
  return (
    <Canvas>
      <Rect ref={box} x={0} y={0} width={10} height={10} color="red" />
    </Canvas>
  )
}

// Only a <Group> is written with a matrix. A recompile could never give this
// operand a slot, so asking for one would re-encode on every write, forever.
test('a transform write to a non-Group is dropped without re-encoding', async () => {
  await render(<Untransformable />)
  scenes = []

  await act(async () => box.set({ translateX: 5 }))
  await act(async () => box.set({ translateX: 9 }))
  await act(async () => box.set({ translateX: 13 }))

  expect(scenes).toEqual([])
  expect(pushed).toEqual([])
})

// ---- Regressions from the re-review of the fix commit ----

const THREE = `
uniform float uA;
uniform float uB;
uniform float uC;
half4 main(float2 pos) { return half4(half(uA), half(uB), half(uC), 1.0); }
`

let rerenderGrown!: () => void

function GrowingUniforms(): React.ReactElement {
  const [, setTick] = useState(0)
  box = useNode()
  rerenderGrown = () => setTick((t) => t + 1)
  return (
    <Canvas>
      <Fill>
        {/* uA and uC are declared by the shader but not by the JSX, so each
            needs a run handed over before it can be patched. */}
        <Shader ref={box} source={THREE} uniforms={{ uB: 3 }} />
      </Fill>
    </Canvas>
  )
}

// The value carried to the compile that hands over a run must be consumed by
// it. Left in place it outranks the slot on the next compile and undoes every
// write made since.
test('a uniform does not snap back to the value that won it its slot', async () => {
  await render(<GrowingUniforms />)

  await act(async () => box.set({ uniforms: { uA: 1 } }))
  await act(async () => box.set({ uniforms: { uA: 9 } }))
  // Needs a run of its own, so it recompiles — and uA must survive that.
  await act(async () => box.set({ uniforms: { uC: 5 } }))
  pushed = []
  await act(async () => box.set({ uniforms: { uB: 11 } }))

  // The values array is the handle's slots in writer order: uA, uB, uC.
  // uA is 9, not the 1 that won it its run.
  expect(pushed.at(-1)).toEqual([9, 11, 5])
})

// Growth appends rather than relocating: a run already handed out keeps its
// offset, so nothing has to read back a slot the UI thread may own.
test('growing one uniform leaves its neighbours where they are', async () => {
  await render(<GrowingUniforms />)

  await act(async () => box.set({ uniforms: { uA: 4 } }))
  await act(async () => box.set({ uniforms: { uB: 6 } }))
  await act(async () => box.set({ uniforms: { uC: 8 } }))
  pushed = []
  await act(async () => box.set({ uniforms: { uB: 6 } }))

  expect(pushed.at(-1)).toEqual([4, 6, 8])
})

function ShaderOnly(): React.ReactElement {
  box = useNode()
  return (
    <Canvas>
      <Fill>
        <Shader ref={box} source={TWO} uniforms={{ uA: 1, uB: 2 }} />
      </Fill>
    </Canvas>
  )
}

// A <Shader> is reached through applyUniforms alone, which reads neither
// `overrides` nor `ops` — so anything else would re-encode and change nothing.
test('a non-uniform write to a shader handle is dropped, not re-encoded', async () => {
  await render(<ShaderOnly />)
  scenes = []

  await act(async () => box.set({ x: 5 }))
  await act(async () => box.set({ translateX: 7 }))
  await act(async () => box.set({ color: '#ff0000' }))

  expect(scenes).toEqual([])
  expect(pushed).toEqual([])
})

// The commit is the source of truth for uniforms too: a value written to a name
// the JSX does not declare has to go with everything else.
test('a React commit drops an imperatively grown uniform', async () => {
  await render(<GrowingUniforms />)

  await act(async () => box.set({ uniforms: { uA: 9 } }))
  pushed = []
  await act(async () => box.set({ uniforms: { uB: 3 } }))
  expect(pushed.at(-1)).toEqual([9, 3])

  scenes = []
  await act(async () => {
    rerenderGrown()
    await new Promise((resolve) => setTimeout(resolve, 20))
  })

  // uA is back to the shader's own default, and holds no slot at all.
  pushed = []
  await act(async () => box.set({ uniforms: { uB: 3 } }))
  expect(pushed.at(-1)).toEqual([3])
})

// ---- Regressions from the third review pass ----

const ONE = `
uniform float uA;
half4 main(float2 pos) { return half4(half(uA), 0.0, 0.0, 1.0); }
`

function ShaderInGroup(): React.ReactElement {
  box = useNode()
  return (
    <Canvas>
      <Group>
        {/* No drawing descendant, so this shader's paint is never written and
            the run it is granted never reaches the program. */}
        <Shader ref={box} source={ONE} uniforms={{ uA: 0 }} />
      </Group>
    </Canvas>
  )
}

// A run granted from pool bookkeeping alone may never reach the program. The
// carried value has to survive that, or the equal-value guard never fires and
// every write re-encodes the whole scene forever.
test('a uniform whose run never reaches the program stops re-encoding', async () => {
  await render(<ShaderInGroup />)
  scenes = []

  for (let i = 0; i < 5; i++) {
    await act(async () => box.set({ uniforms: { uA: 3 } }))
  }

  // The first write asks for a run; the rest compare equal and stop.
  expect(scenes.length).toBeLessThanOrEqual(1)
})

function UniformsOnNode(): React.ReactElement {
  box = useNode()
  return (
    <Canvas>
      {/* The handle is on the drawing node, not on the <Shader>. */}
      <Fill ref={box}>
        <Shader source={ONE} uniforms={{ uA: 0 }} />
      </Fill>
    </Canvas>
  )
}

// apply() never reads uniforms, so the re-encode would be byte-identical and
// the write would land nowhere — once per write, forever.
test('uniforms written to a drawing-node handle are dropped, not re-encoded', async () => {
  await render(<UniformsOnNode />)
  scenes = []

  await act(async () => box.set({ uniforms: { uA: 1 } }))
  await act(async () => box.set({ uniforms: { uA: 2 } }))
  await act(async () => box.set({ uniforms: { uA: 3 } }))

  expect(scenes).toEqual([])
  expect(pushed).toEqual([])
})
