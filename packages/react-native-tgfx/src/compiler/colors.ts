/**
 * Color resolution. Every public color input (hex string, `rgb()/rgba()`,
 * named color, or a packed number) is normalized to a single packed 32-bit
 * integer in `0xAARRGGBB` order, which the native C++ engine unpacks into a
 * `tgfx::Color`. Keeping this purely numeric over the bridge avoids string
 * parsing in native code on every draw.
 */
export type Color = string | number

const NAMED: Record<string, number> = {
  transparent: 0x00000000,
  black: 0xff000000,
  white: 0xffffffff,
  red: 0xffff0000,
  green: 0xff00ff00,
  blue: 0xff0000ff,
  yellow: 0xffffff00,
  cyan: 0xff00ffff,
  magenta: 0xffff00ff,
  orange: 0xffffa500,
  purple: 0xff800080,
  gray: 0xff808080,
  grey: 0xff808080,
  lightblue: 0xffadd8e6,
  lightgray: 0xffd3d3d3,
  lightgrey: 0xffd3d3d3,
  darkgray: 0xffa9a9a9,
  pink: 0xffffc0cb,
  brown: 0xffa52a2a,
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

function fromHex(hex: string): number {
  let h = hex.slice(1)
  if (h.length === 3 || h.length === 4) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('')
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
  return 0xff000000
}

function fromFunc(str: string): number {
  const inside = str.slice(str.indexOf('(') + 1, str.lastIndexOf(')'))
  const parts = inside.split(/[ ,/]+/).filter((p) => p.length > 0)
  const r = parseFloat(parts[0] ?? '0')
  const g = parseFloat(parts[1] ?? '0')
  const b = parseFloat(parts[2] ?? '0')
  const a = parts[3] != null ? parseFloat(parts[3]) : 1
  return pack(Math.round(a * 255), r, g, b)
}

function fromHsl(str: string): number {
  const inside = str.slice(str.indexOf('(') + 1, str.lastIndexOf(')'))
  const parts = inside.split(/[ ,/]+/).filter((p) => p.length > 0)
  const h = parseFloat(parts[0] ?? '0')
  const s = parseFloat(parts[1] ?? '0') / 100
  const l = parseFloat(parts[2] ?? '0') / 100
  const alpha = parts[3] != null ? parseFloat(parts[3]) : 1
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

/** Resolve any supported color input to a packed `0xAARRGGBB` integer. */
export function resolveColor(input: Color | undefined): number {
  if (input == null) {
    return 0xff000000
  }
  if (typeof input === 'number') {
    return input >>> 0
  }
  const str = input.trim().toLowerCase()
  if (str.startsWith('#')) {
    return fromHex(str)
  }
  if (str.startsWith('rgb')) {
    return fromFunc(str)
  }
  if (str.startsWith('hsl')) {
    return fromHsl(str)
  }
  const named = NAMED[str]
  if (named != null) {
    return named
  }
  return 0xff000000
}
