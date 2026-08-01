import { expect, test } from 'bun:test'
import { shallowEqualProps } from './Reconciler'

test('equal when the same keys hold the same values', () => {
  expect(shallowEqualProps({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(true)
  expect(shallowEqualProps({}, {})).toBe(true)
})

test('unequal when a value differs', () => {
  expect(shallowEqualProps({ x: 1 }, { x: 2 })).toBe(false)
})

test('unequal when either side has an extra key', () => {
  expect(shallowEqualProps({ x: 1 }, { x: 1, y: 2 })).toBe(false)
  expect(shallowEqualProps({ x: 1, y: 2 }, { x: 1 })).toBe(false)
})

test('compares by identity, not deeply', () => {
  const shared = { nested: true }
  expect(shallowEqualProps({ a: shared }, { a: shared })).toBe(true)
  expect(
    shallowEqualProps({ a: { nested: true } }, { a: { nested: true } })
  ).toBe(false)
})

test('key order does not matter', () => {
  expect(shallowEqualProps({ x: 1, y: 2 }, { y: 2, x: 1 })).toBe(true)
})
