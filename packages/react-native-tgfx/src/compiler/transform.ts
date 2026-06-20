/**
 * Transform resolution. React-Native-style transform arrays (an array of
 * single-key objects such as `{ translateX: 10 }`, `{ scale: 2 }`,
 * `{ rotate: '45deg' }`) are flattened into a 2x3 affine matrix expressed in
 * tgfx's `setAll` order: `[scaleX, skewX, transX, skewY, scaleY, transY]`.
 *
 * A point (x, y) maps to:
 *   x' = scaleX * x + skewX * y + transX
 *   y' = skewY  * x + scaleY * y + transY
 */
export type TransformOp =
  | { translateX: number }
  | { translateY: number }
  | { translate: [number, number] }
  | { scale: number }
  | { scaleX: number }
  | { scaleY: number }
  | { rotate: number | string }
  | { rotateZ: number | string }
  | { skewX: number | string }
  | { skewY: number | string }
  | { matrix: number[] }

export type Transform = TransformOp[]

export interface Vector {
  x: number
  y: number
}

/** Identity in tgfx order. */
export const IDENTITY: [number, number, number, number, number, number] = [
  1, 0, 0, 0, 1, 0,
]

type Affine = [number, number, number, number, number, number] // tgfx order

function multiply(m1: Affine, m2: Affine): Affine {
  const [a1, c1, e1, b1, d1, f1] = m1
  const [a2, c2, e2, b2, d2, f2] = m2
  return [
    a1 * a2 + c1 * b2,
    a1 * c2 + c1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * a2 + d1 * b2,
    b1 * c2 + d1 * d2,
    b1 * e2 + d1 * f2 + f1,
  ]
}

export function toRadians(v: number | string): number {
  if (typeof v === 'number') {
    return v
  }
  const s = v.trim()
  if (s.endsWith('deg')) {
    return (parseFloat(s) * Math.PI) / 180
  }
  if (s.endsWith('rad')) {
    return parseFloat(s)
  }
  return parseFloat(s)
}

function opToAffine(op: TransformOp): Affine {
  if ('translateX' in op) {
    return [1, 0, op.translateX, 0, 1, 0]
  }
  if ('translateY' in op) {
    return [1, 0, 0, 0, 1, op.translateY]
  }
  if ('translate' in op) {
    return [1, 0, op.translate[0], 0, 1, op.translate[1]]
  }
  if ('scale' in op) {
    return [op.scale, 0, 0, 0, op.scale, 0]
  }
  if ('scaleX' in op) {
    return [op.scaleX, 0, 0, 0, 1, 0]
  }
  if ('scaleY' in op) {
    return [1, 0, 0, 0, op.scaleY, 0]
  }
  if ('rotate' in op || 'rotateZ' in op) {
    const r = toRadians('rotate' in op ? op.rotate : op.rotateZ)
    const cos = Math.cos(r)
    const sin = Math.sin(r)
    return [cos, -sin, 0, sin, cos, 0]
  }
  if ('skewX' in op) {
    return [1, Math.tan(toRadians(op.skewX)), 0, 0, 1, 0]
  }
  if ('skewY' in op) {
    return [1, 0, 0, Math.tan(toRadians(op.skewY)), 1, 0]
  }
  if ('matrix' in op) {
    const m = op.matrix
    // Accept a 6-value affine [scaleX, skewX, transX, skewY, scaleY, transY].
    if (m.length === 6) {
      return [m[0] ?? 1, m[1] ?? 0, m[2] ?? 0, m[3] ?? 0, m[4] ?? 1, m[5] ?? 0]
    }
  }
  return [...IDENTITY]
}

/**
 * Resolve a transform array (optionally anchored at `origin`) into a tgfx affine
 * matrix. Returns `undefined` when the result is the identity so the compiler
 * can omit it from the scene.
 */
export function resolveTransform(
  transform: Transform | undefined,
  origin?: Vector
): Affine | undefined {
  if (transform == null || transform.length === 0) {
    return undefined
  }
  let m: Affine = [...IDENTITY]
  for (const op of transform) {
    m = multiply(m, opToAffine(op))
  }
  if (origin != null && (origin.x !== 0 || origin.y !== 0)) {
    const pre: Affine = [1, 0, origin.x, 0, 1, origin.y]
    const post: Affine = [1, 0, -origin.x, 0, 1, -origin.y]
    m = multiply(multiply(pre, m), post)
  }
  const isIdentity =
    m[0] === 1 &&
    m[1] === 0 &&
    m[2] === 0 &&
    m[3] === 0 &&
    m[4] === 1 &&
    m[5] === 0
  return isIdentity ? undefined : m
}
