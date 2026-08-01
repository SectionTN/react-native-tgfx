import { beforeEach, describe, expect, it } from 'bun:test'
import { colorCacheTestHooks, resolveColor } from './colors'

const parsesDuring = (fn: () => void): number => {
  const before = colorCacheTestHooks.parses
  fn()
  return colorCacheTestHooks.parses - before
}

// Must exceed CACHE_LIMIT, or the retention path is never exercised.
const overflow = (): void => {
  for (let i = 0; i < colorCacheTestHooks.limit * 2; i += 1) {
    resolveColor(`rgb(${i}, ${i}, ${i})`)
  }
}

describe('resolveColor', () => {
  beforeEach(() => {
    colorCacheTestHooks.reset()
  })

  it('parses a given string only once', () => {
    resolveColor('#ff8800')
    expect(parsesDuring(() => resolveColor('#ff8800'))).toBe(0)
  })

  it('fills the cache to its limit and stops there', () => {
    overflow()
    expect(colorCacheTestHooks.size).toBe(colorCacheTestHooks.limit)
  })

  it('keeps an early color resident after the cache overflows', () => {
    resolveColor('#010203')
    overflow()
    expect(parsesDuring(() => resolveColor('#010203'))).toBe(0)
  })

  it('does not evict the resident set when overflowing repeatedly', () => {
    resolveColor('#040506')
    overflow()
    overflow()
    overflow()
    expect(parsesDuring(() => resolveColor('#040506'))).toBe(0)
  })

  it('returns correct values for every supported form', () => {
    expect(resolveColor('#112233')).not.toBe(resolveColor('#332211'))
    expect(resolveColor('  #AABBCC  ')).toBe(resolveColor('#aabbcc'))
    expect(resolveColor('RED')).toBe(resolveColor('red'))
    expect(resolveColor(0xff102030)).toBe(0xff102030)
    expect(resolveColor(undefined)).toBe(0xff000000)
  })

  it('does not consult the cache for numbers', () => {
    expect(parsesDuring(() => resolveColor(0xff445566))).toBe(0)
  })

  it('does not return inherited Object properties for named lookups', () => {
    for (const key of ['constructor', '__proto__', 'toString', 'valueOf']) {
      expect(typeof resolveColor(key)).toBe('number')
    }
  })
})
