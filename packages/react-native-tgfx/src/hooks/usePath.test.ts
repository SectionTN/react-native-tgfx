import { beforeEach, expect, test } from 'bun:test'
import { nativeMocks } from '../testing/nativeMocks'

const calls: { method: string; args: unknown[] }[] = []

const native = {
  op: (...args: unknown[]) => record('op', args, 'M0 0'),
  bounds: (...args: unknown[]) =>
    record('bounds', args, { x: 1, y: 2, width: 3, height: 4 }),
  contains: (...args: unknown[]) => record('contains', args, true),
  transform: (...args: unknown[]) => record('transform', args, 'M1 1'),
  length: (...args: unknown[]) => record('length', args, 10),
  pointAtLength: (...args: unknown[]) =>
    record('pointAtLength', args, { x: 5, y: 0, angle: 0 }),
  segment: (...args: unknown[]) => record('segment', args, 'M2 2'),
}

function record<T>(method: string, args: unknown[], result: T): T {
  calls.push({ method, args })
  return result
}

nativeMocks.hybridObject = () => native

const {
  pathBounds,
  pathContains,
  pathLength,
  pathOp,
  pathPointAtLength,
  pathSegment,
  pathTransform,
} = await import('./usePath')

beforeEach(() => {
  calls.length = 0
})

test('every utility forwards its arguments to native unchanged', () => {
  pathOp('a', 'b', 'union')
  pathContains('a', 3, 4)
  pathTransform('a', [1, 0, 0, 1, 5, 6])
  pathLength('a')
  pathPointAtLength('a', 7)
  pathSegment('a', 1, 2)
  expect(calls).toEqual([
    { method: 'op', args: ['a', 'b', 'union'] },
    { method: 'contains', args: ['a', 3, 4] },
    { method: 'transform', args: ['a', [1, 0, 0, 1, 5, 6]] },
    { method: 'length', args: ['a'] },
    { method: 'pointAtLength', args: ['a', 7] },
    { method: 'segment', args: ['a', 1, 2] },
  ])
})

test('bounds are loose unless tight is asked for', () => {
  expect(pathBounds('a')).toEqual({ x: 1, y: 2, width: 3, height: 4 })
  pathBounds('a', true)
  expect(calls.map((c) => c.args[1])).toEqual([false, true])
})

test('the hybrid object is created once and reused', () => {
  let created = 0
  nativeMocks.hybridObject = () => {
    created++
    return native
  }
  pathLength('a')
  pathLength('b')
  expect(created).toBe(0)
})
