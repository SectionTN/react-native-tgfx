import { expect, mock, test } from 'bun:test'
import { createHandle } from '../imperative'
import type { CanvasHandle, HitTestResult } from '../types'

// createHandle reaches for runOnJS; the hook itself needs no React at all.
mock.module('react-native-reanimated', () => ({}))

const { useCanvasPress, dispatchPress } =
  await import('../hooks/useCanvasPress')

function canvasReturning(hits: HitTestResult[]) {
  const calls: { x: number; y: number; precise?: boolean }[] = []
  const handle = {
    hitTest: (x: number, y: number, options?: { precise?: boolean }) => {
      calls.push({ x, y, precise: options?.precise })
      return hits
    },
  } as unknown as CanvasHandle
  return { ref: { current: handle }, calls }
}

const press = (x: number, y: number) => ({
  nativeEvent: { locationX: x, locationY: y },
})

test('dispatches to the topmost hit and stops there', () => {
  const top = createHandle()
  const under = createHandle()
  const fired: string[] = []
  const { ref } = canvasReturning([
    { node: top, path: [1] },
    { node: under, path: [0] },
  ])

  useCanvasPress(ref, [
    [top, () => fired.push('top')],
    [under, () => fired.push('under')],
  ])(press(5, 5))

  expect(fired).toEqual(['top'])
})

test('falls through a hit with no handler to the one beneath', () => {
  const bare = createHandle()
  const wanted = createHandle()
  const fired: string[] = []
  const { ref } = canvasReturning([
    { node: bare, path: [2] },
    { node: wanted, path: [1] },
  ])

  useCanvasPress(ref, [[wanted, () => fired.push('wanted')]])(press(1, 1))

  expect(fired).toEqual(['wanted'])
})

test('reports every hit to onPress, including unnamed ones', () => {
  const named = createHandle()
  const seen: (typeof named | null)[][] = []
  const { ref } = canvasReturning([
    { node: null, path: [3] },
    { node: named, path: [0] },
  ])

  useCanvasPress(ref, [], {
    onPress: ({ nodes, x, y }) => {
      seen.push(nodes)
      expect(x).toBe(7)
      expect(y).toBe(9)
    },
  })(press(7, 9))

  expect(seen).toEqual([[null, named]])
})

test('passes precise through and survives an unmounted canvas', () => {
  const { ref, calls } = canvasReturning([])
  useCanvasPress(ref, [], { precise: true })(press(2, 3))
  expect(calls).toEqual([{ x: 2, y: 3, precise: true }])

  const empty = { current: null }
  expect(() => useCanvasPress(empty, [])(press(0, 0))).not.toThrow()
})

test('dispatchPress alone: topmost wins, nulls are skipped, misses report false', () => {
  const top = createHandle()
  const under = createHandle()
  const fired: string[] = []
  const handlers: [ReturnType<typeof createHandle>, () => void][] = [
    [top, () => fired.push('top')],
    [under, () => fired.push('under')],
  ]
  expect(dispatchPress([null, top, under], handlers)).toBe(true)
  expect(fired).toEqual(['top'])
  expect(dispatchPress([null, null], handlers)).toBe(false)
  expect(dispatchPress([], handlers)).toBe(false)
  expect(fired).toEqual(['top'])
})
