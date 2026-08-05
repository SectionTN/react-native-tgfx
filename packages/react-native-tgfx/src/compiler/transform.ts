// React-Native-style transform arrays of single-key objects, composed left to right natively.

type Num = number | { value: number }
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
