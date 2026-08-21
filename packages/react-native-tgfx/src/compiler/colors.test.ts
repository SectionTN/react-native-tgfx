import { beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { colorCacheTestHooks, resolveColor } from './colors'

// The warning is __DEV__-gated, so the flag Metro injects has to exist here.
;(globalThis as { __DEV__?: boolean }).__DEV__ = true

const parsesDuring = (fn: () => void): number => {
  const before = colorCacheTestHooks.parses()
  fn()
  return colorCacheTestHooks.parses() - before
}

const warningsDuring = (fn: () => void): string[] => {
  const warn = spyOn(console, 'warn').mockImplementation(() => {})
  try {
    fn()
    return warn.mock.calls.map((c) => String(c[0]))
  } finally {
    warn.mockRestore()
  }
}

// Must exceed CACHE_LIMIT, or the retention path is never exercised.
const overflow = (): void => {
  for (let i = 0; i < colorCacheTestHooks.limit() * 2; i += 1) {
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
    expect(colorCacheTestHooks.size()).toBe(colorCacheTestHooks.limit())
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
      const warnings = warningsDuring(() => {
        expect(resolveColor(key)).toBe(0xff000000)
      })
      expect(warnings).toHaveLength(1)
    }
  })

  it('resolves both spellings of every grey/gray name', () => {
    for (const stem of ['', 'light', 'dark', 'dim', 'slate', 'darkslate']) {
      expect(resolveColor(`${stem}grey`)).toBe(resolveColor(`${stem}gray`))
      expect(resolveColor(`${stem}grey`)).not.toBe(0xff000000)
    }
    expect(resolveColor('lightslategrey')).toBe(resolveColor('lightslategray'))
  })

  it('resolves CSS names beyond the original short list', () => {
    for (const name of ['rebeccapurple', 'seagreen', 'tomato', 'gainsboro']) {
      expect(resolveColor(name)).not.toBe(0xff000000)
    }
  })

  // `green` was #00ff00, which is `lime`; `lime` and `darkgrey` were absent.
  it('uses the CSS value for names an sRGB-vs-lime mixup gets wrong', () => {
    expect(resolveColor('green')).toBe(0xff008000)
    expect(resolveColor('lime')).toBe(0xff00ff00)
    expect(resolveColor('green')).not.toBe(resolveColor('lime'))
    expect(resolveColor('darkgrey')).toBe(0xffa9a9a9)
    expect(resolveColor('darkgrey')).toBe(resolveColor('darkgray'))
    expect(resolveColor('gray')).toBe(0xff808080)
    expect(resolveColor('purple')).toBe(0xff800080)
    expect(resolveColor('maroon')).toBe(0xff800000)
    expect(resolveColor('olive')).toBe(0xff808000)
    expect(resolveColor('navy')).toBe(0xff000080)
    expect(resolveColor('teal')).toBe(0xff008080)
    expect(resolveColor('silver')).toBe(0xffc0c0c0)
    expect(resolveColor('aqua')).toBe(resolveColor('cyan'))
    expect(resolveColor('fuchsia')).toBe(resolveColor('magenta'))
  })

  it('warns on an unknown name instead of silently going black', () => {
    const warnings = warningsDuring(() => {
      expect(resolveColor('nosuchcolor')).toBe(0xff000000)
    })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('nosuchcolor')
  })

  it('warns on a malformed function or hex form', () => {
    for (const bad of [
      'rgb(oops)',
      'rgb(1, 2)',
      'hsl(nope)',
      '#gggggg',
      '#12',
    ]) {
      const warnings = warningsDuring(() => {
        expect(resolveColor(bad)).toBe(0xff000000)
      })
      expect(warnings).toHaveLength(1)
    }
  })

  it('warns once per distinct bad input, not once per resolve', () => {
    const warnings = warningsDuring(() => {
      for (let i = 0; i < 50; i += 1) {
        resolveColor('rgb(oops)')
      }
    })
    expect(warnings).toHaveLength(1)
  })

  it('still warns only once for a bad input after the cache is full', () => {
    overflow()
    const warnings = warningsDuring(() => {
      resolveColor('rgb(nope)')
      resolveColor('rgb(nope)')
    })
    expect(warnings).toHaveLength(1)
  })

  it('never warns for a supported color', () => {
    const warnings = warningsDuring(() => {
      for (const good of [
        '#fff',
        '#ff8800',
        '#ff8800cc',
        'rgb(1, 2, 3)',
        'rgba(1, 2, 3, 0.5)',
        'hsl(120, 50%, 50%)',
        'darkgrey',
      ]) {
        resolveColor(good)
      }
    })
    expect(warnings).toEqual([])
  })

  // 0 is a real color, so the failure check has to be `=== undefined`.
  it('treats a zero-valued color as parsed, not as a failure', () => {
    for (const zero of ['transparent', '#00000000', 'rgba(0, 0, 0, 0)']) {
      const warnings = warningsDuring(() => {
        expect(resolveColor(zero)).toBe(0x00000000)
      })
      expect(warnings).toEqual([])
    }
  })

  it('leaves an undefined color as opaque black without warning', () => {
    const warnings = warningsDuring(() => {
      expect(resolveColor(undefined)).toBe(0xff000000)
    })
    expect(warnings).toEqual([])
  })

  // Percentages are valid CSS and never warn, so reading them as 0..255 is silently wrong.
  it('scales percentage components and alpha', () => {
    expect(resolveColor('rgb(100%, 0%, 0%)')).toBe(0xffff0000)
    expect(resolveColor('rgb(50% 50% 50%)')).toBe(0xff808080)
    expect(resolveColor('rgba(255 0 0 / 50%)')).toBe(0x80ff0000)
    expect(resolveColor('hsl(0 100% 50% / 50%)')).toBe(0x80ff0000)
    expect(resolveColor('rgba(255, 0, 0, 0.5)')).toBe(0x80ff0000)
  })
})

describe('color()', () => {
  it('parses CSS Color 4 color() in srgb and display-p3', () => {
    // srgb components are 0..1, so this is plain red.
    expect(resolveColor('color(srgb 1 0 0)')).toBe(0xffff0000)
    expect(resolveColor('color(srgb 0 0 0 / 0.5)')).toBe(0x80000000)

    // P3 red is outside sRGB, so it clips to the nearest in-gamut red.
    expect(resolveColor('color(display-p3 1 0 0)')).toBe(0xffff0000)
    // A mid grey is gamut-independent, so it survives the round trip.
    const grey = resolveColor('color(display-p3 0.5 0.5 0.5)')
    const [gr, gg, gb] = [
      (grey >>> 16) & 0xff,
      (grey >>> 8) & 0xff,
      grey & 0xff,
    ]
    // Neutral in both spaces, so it survives the round trip to within a rounding step.
    expect(Math.abs(gr - gg)).toBeLessThanOrEqual(1)
    expect(Math.abs(gb - gg)).toBeLessThanOrEqual(1)
    expect(Math.abs(gg - 128)).toBeLessThanOrEqual(2)

    // A P3 green is more saturated than sRGB can hold, so red clips to zero.
    expect(resolveColor('color(display-p3 0 1 0)') & 0x00ff0000).toBe(0)
  })

  it('rejects an unknown colour space and malformed components', () => {
    // Falls back to opaque black, like any other unparseable colour.
    expect(resolveColor('color(rec2020 1 0 0)')).toBe(0xff000000)
    expect(resolveColor('color(display-p3 1 0)')).toBe(0xff000000)
    expect(resolveColor('color(display-p3 a b c)')).toBe(0xff000000)
  })
})
