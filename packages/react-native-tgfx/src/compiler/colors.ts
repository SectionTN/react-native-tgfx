// Every colour input is normalized to a packed 0xAARRGGBB integer; an unparseable one is black.
import { resolveNumber, type MaybeSharedValue } from './values'

/**
 * Red, green, blue, alpha, each 0..1. The one colour form that can carry a
 * SharedValue per channel, and so the one the engine can patch per frame — a
 * packed integer cannot survive the float32 slot it would have to travel in.
 */
export type ColorComponents = readonly [
  MaybeSharedValue<number> | number,
  MaybeSharedValue<number> | number,
  MaybeSharedValue<number> | number,
  MaybeSharedValue<number> | number,
]

export type Color = string | number | ColorComponents

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

// `50%` is 0..100 of the channel range, a bare token is already 0..255.
function parseComponent(token: string | undefined): number {
  const n = parseFloat(token ?? '')
  // `(n / 100) * 255`, not `n * 2.55`: the latter puts 50% at 127.49999999999999.
  return token?.endsWith('%') === true ? (n / 100) * 255 : n
}

// A `%` alpha is 0..100, a bare alpha is already 0..1.
function parseAlpha(token: string | undefined): number {
  if (token == null) {
    return 1
  }
  const n = parseFloat(token)
  return token.endsWith('%') ? n / 100 : n
}

function fromFunc(str: string): number | undefined {
  const inside = str.slice(str.indexOf('(') + 1, str.lastIndexOf(')'))
  const parts = inside.split(/[ ,/]+/).filter((p) => p.length > 0)
  const r = parseComponent(parts[0])
  const g = parseComponent(parts[1])
  const b = parseComponent(parts[2])
  const a = parseAlpha(parts[3])
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
  const alpha = parseAlpha(parts[3])
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

const CACHE = new Map<string, number>()
const CACHE_LIMIT = 512

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
      'Expected #rgb/#rgba/#rrggbb/#rrggbbaa, rgb()/rgba(), hsl()/hsla(), color(display-p3 r g b), a CSS color name, or a packed 0xAARRGGBB number.'
  )
}

/**
 * CSS Color 4 `color(<space> r g b / a)`, the syntax a wide-gamut colour arrives
 * in. Components are 0..1 rather than 0..255.
 *
 * Only `display-p3` and `srgb` are accepted, and a P3 colour is **converted to
 * sRGB here** rather than carried through — the wire format holds one packed
 * sRGB word per colour. On a P3 surface that clamps the extra gamut, which is
 * the honest behaviour until the program can carry a colour space.
 */
function fromColorFunc(str: string): number | undefined {
  const open = str.indexOf('(')
  const close = str.lastIndexOf(')')
  if (open < 0 || close < open) {
    return undefined
  }
  const parts = str
    .slice(open + 1, close)
    .replace('/', ' ')
    .split(/[\s,]+/)
    .filter((part) => part.length > 0)
  const space = parts[0]
  if (space !== 'display-p3' && space !== 'srgb') {
    return undefined
  }
  const nums = parts.slice(1).map(Number)
  if (nums.length < 3 || nums.some((n) => !Number.isFinite(n))) {
    return undefined
  }
  const [r, g, b] = nums as [number, number, number]
  const alpha = nums.length > 3 ? nums[3]! : 1
  const rgb = space === 'display-p3' ? p3ToSrgb(r, g, b) : ([r, g, b] as const)
  return (
    ((clamp255(alpha * 255) << 24) |
      (clamp255(rgb[0] * 255) << 16) |
      (clamp255(rgb[1] * 255) << 8) |
      clamp255(rgb[2] * 255)) >>>
    0
  )
}

function clamp255(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

/// Linearise, apply the P3-to-sRGB matrix, re-encode. Out-of-gamut clips.
function p3ToSrgb(r: number, g: number, b: number): readonly [number, number, number] {
  const lin = (c: number) =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  // Clamped first: an out-of-gamut channel goes negative, and Math.pow of that is NaN.
  const enc = (raw: number) => {
    const c = Math.max(0, Math.min(1, raw))
    return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
  }
  const [lr, lg, lb] = [lin(r), lin(g), lin(b)]
  return [
    enc(1.2249401 * lr - 0.2249404 * lg + 0.0000000 * lb),
    enc(-0.0420569 * lr + 1.0420571 * lg + 0.0000000 * lb),
    enc(-0.0196376 * lr - 0.0786361 * lg + 1.0982735 * lb),
  ] as const
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
  } else if (str.startsWith('color(')) {
    value = fromColorFunc(str)
  } else if (Object.hasOwn(NAMED, str)) {
    value = NAMED[str]
  }
  if (value === undefined) {
    warnUnparseable(str)
    // Opaque black is `PaintCmd::color`'s default, so a bad colour degrades like a missing one.
    return 0xff000000
  }
  return value
}

/** True for the four-channel form, the only one that can carry a live value. */
export function isColorComponents(input: unknown): input is ColorComponents {
  return Array.isArray(input) && input.length === 4
}

function channel(input: unknown): number {
  const n = resolveNumber(input, 0)
  return Math.round(Math.min(1, Math.max(0, n)) * 255)
}

/** Unpack `0xAARRGGBB` into the four 0..1 channels, in `ColorComponents` order. */
export function colorChannels(
  packed: number
): [number, number, number, number] {
  return [
    ((packed >>> 16) & 0xff) / 255,
    ((packed >>> 8) & 0xff) / 255,
    (packed & 0xff) / 255,
    ((packed >>> 24) & 0xff) / 255,
  ]
}

/** Resolve any supported color input to a packed `0xAARRGGBB` integer. */
export function resolveColor(input: Color | undefined): number {
  if (input == null) {
    return 0xff000000
  }
  if (typeof input === 'number') {
    return input >>> 0
  }
  if (isColorComponents(input)) {
    return (
      ((channel(input[3]) << 24) |
        (channel(input[0]) << 16) |
        (channel(input[1]) << 8) |
        channel(input[2])) >>>
      0
    )
  }
  const cached = CACHE.get(input)
  if (cached !== undefined) {
    return cached
  }
  const value = parseColor(input.trim().toLowerCase())
  // Keep the first entries rather than evicting: a scene past the cap would refill every frame.
  if (CACHE.size < CACHE_LIMIT) {
    CACHE.set(input, value)
  }
  return value
}
