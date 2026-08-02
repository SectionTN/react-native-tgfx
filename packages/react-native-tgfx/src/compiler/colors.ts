/**
 * Color resolution. Every public color input (hex string, `rgb()/rgba()`,
 * `hsl()/hsla()`, a CSS color name, or a packed number) is normalized to a
 * single packed 32-bit integer in `0xAARRGGBB` order, which the native C++
 * engine unpacks into a `tgfx::Color`. Keeping this purely numeric over the
 * bridge avoids string parsing in native code on every draw.
 *
 * An input that cannot be parsed resolves to opaque black and warns once in
 * `__DEV__`, matching how a missing color already degrades.
 */
export type Color = string | number

const NAMED: Record<string, number> = {
  aliceblue: 0xfff0f8ff,
  antiquewhite: 0xfffaebd7,
  aqua: 0xff00ffff,
  aquamarine: 0xff7fffd4,
  azure: 0xfff0ffff,
  beige: 0xfff5f5dc,
  bisque: 0xffffe4c4,
  black: 0xff000000,
  blanchedalmond: 0xffffebcd,
  blue: 0xff0000ff,
  blueviolet: 0xff8a2be2,
  brown: 0xffa52a2a,
  burlywood: 0xffdeb887,
  burntsienna: 0xffea7e5d,
  cadetblue: 0xff5f9ea0,
  chartreuse: 0xff7fff00,
  chocolate: 0xffd2691e,
  coral: 0xffff7f50,
  cornflowerblue: 0xff6495ed,
  cornsilk: 0xfffff8dc,
  crimson: 0xffdc143c,
  cyan: 0xff00ffff,
  darkblue: 0xff00008b,
  darkcyan: 0xff008b8b,
  darkgoldenrod: 0xffb8860b,
  darkgray: 0xffa9a9a9,
  darkgreen: 0xff006400,
  darkgrey: 0xffa9a9a9,
  darkkhaki: 0xffbdb76b,
  darkmagenta: 0xff8b008b,
  darkolivegreen: 0xff556b2f,
  darkorange: 0xffff8c00,
  darkorchid: 0xff9932cc,
  darkred: 0xff8b0000,
  darksalmon: 0xffe9967a,
  darkseagreen: 0xff8fbc8f,
  darkslateblue: 0xff483d8b,
  darkslategray: 0xff2f4f4f,
  darkslategrey: 0xff2f4f4f,
  darkturquoise: 0xff00ced1,
  darkviolet: 0xff9400d3,
  deeppink: 0xffff1493,
  deepskyblue: 0xff00bfff,
  dimgray: 0xff696969,
  dimgrey: 0xff696969,
  dodgerblue: 0xff1e90ff,
  firebrick: 0xffb22222,
  floralwhite: 0xfffffaf0,
  forestgreen: 0xff228b22,
  fuchsia: 0xffff00ff,
  gainsboro: 0xffdcdcdc,
  ghostwhite: 0xfff8f8ff,
  gold: 0xffffd700,
  goldenrod: 0xffdaa520,
  gray: 0xff808080,
  green: 0xff008000,
  greenyellow: 0xffadff2f,
  grey: 0xff808080,
  honeydew: 0xfff0fff0,
  hotpink: 0xffff69b4,
  indianred: 0xffcd5c5c,
  indigo: 0xff4b0082,
  ivory: 0xfffffff0,
  khaki: 0xfff0e68c,
  lavender: 0xffe6e6fa,
  lavenderblush: 0xfffff0f5,
  lawngreen: 0xff7cfc00,
  lemonchiffon: 0xfffffacd,
  lightblue: 0xffadd8e6,
  lightcoral: 0xfff08080,
  lightcyan: 0xffe0ffff,
  lightgoldenrodyellow: 0xfffafad2,
  lightgray: 0xffd3d3d3,
  lightgreen: 0xff90ee90,
  lightgrey: 0xffd3d3d3,
  lightpink: 0xffffb6c1,
  lightsalmon: 0xffffa07a,
  lightseagreen: 0xff20b2aa,
  lightskyblue: 0xff87cefa,
  lightslategray: 0xff778899,
  lightslategrey: 0xff778899,
  lightsteelblue: 0xffb0c4de,
  lightyellow: 0xffffffe0,
  lime: 0xff00ff00,
  limegreen: 0xff32cd32,
  linen: 0xfffaf0e6,
  magenta: 0xffff00ff,
  maroon: 0xff800000,
  mediumaquamarine: 0xff66cdaa,
  mediumblue: 0xff0000cd,
  mediumorchid: 0xffba55d3,
  mediumpurple: 0xff9370db,
  mediumseagreen: 0xff3cb371,
  mediumslateblue: 0xff7b68ee,
  mediumspringgreen: 0xff00fa9a,
  mediumturquoise: 0xff48d1cc,
  mediumvioletred: 0xffc71585,
  midnightblue: 0xff191970,
  mintcream: 0xfff5fffa,
  mistyrose: 0xffffe4e1,
  moccasin: 0xffffe4b5,
  navajowhite: 0xffffdead,
  navy: 0xff000080,
  oldlace: 0xfffdf5e6,
  olive: 0xff808000,
  olivedrab: 0xff6b8e23,
  orange: 0xffffa500,
  orangered: 0xffff4500,
  orchid: 0xffda70d6,
  palegoldenrod: 0xffeee8aa,
  palegreen: 0xff98fb98,
  paleturquoise: 0xffafeeee,
  palevioletred: 0xffdb7093,
  papayawhip: 0xffffefd5,
  peachpuff: 0xffffdab9,
  peru: 0xffcd853f,
  pink: 0xffffc0cb,
  plum: 0xffdda0dd,
  powderblue: 0xffb0e0e6,
  purple: 0xff800080,
  rebeccapurple: 0xff663399,
  red: 0xffff0000,
  rosybrown: 0xffbc8f8f,
  royalblue: 0xff4169e1,
  saddlebrown: 0xff8b4513,
  salmon: 0xfffa8072,
  sandybrown: 0xfff4a460,
  seagreen: 0xff2e8b57,
  seashell: 0xfffff5ee,
  sienna: 0xffa0522d,
  silver: 0xffc0c0c0,
  skyblue: 0xff87ceeb,
  slateblue: 0xff6a5acd,
  slategray: 0xff708090,
  slategrey: 0xff708090,
  snow: 0xfffffafa,
  springgreen: 0xff00ff7f,
  steelblue: 0xff4682b4,
  tan: 0xffd2b48c,
  teal: 0xff008080,
  thistle: 0xffd8bfd8,
  tomato: 0xffff6347,
  transparent: 0x00000000,
  turquoise: 0xff40e0d0,
  violet: 0xffee82ee,
  wheat: 0xfff5deb3,
  white: 0xffffffff,
  whitesmoke: 0xfff5f5f5,
  yellow: 0xffffff00,
  yellowgreen: 0xff9acd32,
}

function clampByte(n: number): number {
  if (n < 0) {
    return 0
  }
  if (n > 255) {
    return 255
  }
  return Math.round(n)
}

function pack(a: number, r: number, g: number, b: number): number {
  // >>> 0 keeps the result an unsigned 32-bit integer.
  return (
    ((clampByte(a) << 24) |
      (clampByte(r) << 16) |
      (clampByte(g) << 8) |
      clampByte(b)) >>>
    0
  )
}

const HEX_DIGITS = /^[0-9a-f]+$/

function fromHex(hex: string): number | undefined {
  let h = hex.slice(1)
  if (h.length === 3 || h.length === 4) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('')
  }
  // parseInt stops at the first non-hex digit, so validate before trusting it.
  if (!HEX_DIGITS.test(h)) {
    return undefined
  }
  if (h.length === 6) {
    h = 'ff' + h.slice(0, 6)
    const v = parseInt(h, 16)
    return v >>> 0
  }
  if (h.length === 8) {
    // input is RRGGBBAA -> repack to AARRGGBB
    const r = parseInt(h.slice(0, 2), 16)
    const g = parseInt(h.slice(2, 4), 16)
    const b = parseInt(h.slice(4, 6), 16)
    const a = parseInt(h.slice(6, 8), 16)
    return pack(a, r, g, b)
  }
  return undefined
}

function allFinite(...ns: number[]): boolean {
  return ns.every((n) => Number.isFinite(n))
}

function fromFunc(str: string): number | undefined {
  const inside = str.slice(str.indexOf('(') + 1, str.lastIndexOf(')'))
  const parts = inside.split(/[ ,/]+/).filter((p) => p.length > 0)
  const r = parseFloat(parts[0] ?? '')
  const g = parseFloat(parts[1] ?? '')
  const b = parseFloat(parts[2] ?? '')
  const a = parts[3] != null ? parseFloat(parts[3]) : 1
  if (!allFinite(r, g, b, a)) {
    return undefined
  }
  return pack(Math.round(a * 255), r, g, b)
}

function fromHsl(str: string): number | undefined {
  const inside = str.slice(str.indexOf('(') + 1, str.lastIndexOf(')'))
  const parts = inside.split(/[ ,/]+/).filter((p) => p.length > 0)
  const h = parseFloat(parts[0] ?? '')
  const s = parseFloat(parts[1] ?? '') / 100
  const l = parseFloat(parts[2] ?? '') / 100
  const alpha = parts[3] != null ? parseFloat(parts[3]) : 1
  if (!allFinite(h, s, l, alpha)) {
    return undefined
  }
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r = 0
  let g = 0
  let b = 0
  if (hp < 1) {
    r = c
    g = x
  } else if (hp < 2) {
    r = x
    g = c
  } else if (hp < 3) {
    g = c
    b = x
  } else if (hp < 4) {
    g = x
    b = c
  } else if (hp < 5) {
    r = x
    b = c
  } else {
    r = c
    b = x
  }
  const m = l - c / 2
  return pack(
    Math.round(alpha * 255),
    (r + m) * 255,
    (g + m) * 255,
    (b + m) * 255
  )
}

// Scenes reuse a handful of colors across every node, and this runs once per
// node per commit, so parsing is cached by the raw string.
const CACHE = new Map<string, number>()
const CACHE_LIMIT = 512

// A bad color is a source-code bug, so warn once per distinct input rather than
// once per node per frame. Capped so a scene generating garbage cannot grow it.
const WARNED = new Set<string>()

/** Test hooks, so tests can assert the cache caches and retains. */
export const colorCacheTestHooks = {
  parses: 0,
  reset(): void {
    CACHE.clear()
    WARNED.clear()
    colorCacheTestHooks.parses = 0
  },
  get size(): number {
    return CACHE.size
  },
  get limit(): number {
    return CACHE_LIMIT
  },
}

function warnUnparseable(str: string): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return
  }
  if (WARNED.has(str) || WARNED.size >= CACHE_LIMIT) {
    return
  }
  WARNED.add(str)
  console.warn(
    `[react-native-tgfx] Unrecognized color "${str}", rendering opaque black. ` +
      'Expected #rgb/#rgba/#rrggbb/#rrggbbaa, rgb()/rgba(), hsl()/hsla(), a CSS color name, or a packed 0xAARRGGBB number.'
  )
}

function parseColor(str: string): number {
  colorCacheTestHooks.parses += 1
  let value: number | undefined
  if (str.startsWith('#')) {
    value = fromHex(str)
  } else if (str.startsWith('rgb')) {
    value = fromFunc(str)
  } else if (str.startsWith('hsl')) {
    value = fromHsl(str)
  } else if (Object.hasOwn(NAMED, str)) {
    value = NAMED[str]
  }
  if (value === undefined) {
    warnUnparseable(str)
    // Opaque black matches `PaintCmd::color`'s default, so an unparseable color
    // degrades the same way a missing one does instead of vanishing.
    return 0xff000000
  }
  return value
}

/** Resolve any supported color input to a packed `0xAARRGGBB` integer. */
export function resolveColor(input: Color | undefined): number {
  if (input == null) {
    return 0xff000000
  }
  if (typeof input === 'number') {
    return input >>> 0
  }
  const cached = CACHE.get(input)
  if (cached !== undefined) {
    return cached
  }
  const value = parseColor(input.trim().toLowerCase())
  // Keep the first CACHE_LIMIT entries resident rather than evicting: a scene
  // just past the cap would otherwise refill and clear every frame.
  if (CACHE.size < CACHE_LIMIT) {
    CACHE.set(input, value)
  }
  return value
}
