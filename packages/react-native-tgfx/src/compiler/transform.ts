/**
 * React-Native-style transform arrays: an array of single-key objects such as
 * `{ translateX: 10 }`, `{ scale: 2 }`, `{ rotate: '45deg' }`. The compiler turns
 * each operand into either a literal or an animated value slot, and the native
 * engine composes them left to right.
 */

/** A transform operand: a literal, or a Reanimated SharedValue. */
type Num = number | { value: number }
/** An angle. Literals may use `deg`/`rad` suffixes; SharedValues are radians. */
type Angle = number | `${number}deg` | `${number}rad` | { value: number }

export type TransformOp =
  | { translateX: Num }
  | { translateY: Num }
  | { translate: [Num, Num] }
  | { scale: Num }
  | { scaleX: Num }
  | { scaleY: Num }
  | { rotate: Angle }
  | { rotateZ: Angle }
  | { skewX: Angle }
  | { skewY: Angle }

export type Transform = TransformOp[]

export interface Vector {
  x: number
  y: number
}

export function toRadians(v: number | string): number {
  if (typeof v === 'number') {
    return v
  }
  const s = v.trim()
  if (s.endsWith('deg')) {
    return (parseFloat(s) * Math.PI) / 180
  }
  return parseFloat(s)
}
