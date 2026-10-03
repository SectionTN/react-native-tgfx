'worklet'

// React-Native-style transform arrays of single-key objects, composed left to right natively.

export type TransformNumber = number | { value: number }
export type TransformAngle =
  | number
  | `${number}deg`
  | `${number}rad`
  | { value: number }

export type TransformOp =
  | { translateX: TransformNumber }
  | { translateY: TransformNumber }
  | { translate: [TransformNumber, TransformNumber] }
  | { scale: TransformNumber }
  | { scaleX: TransformNumber }
  | { scaleY: TransformNumber }
  | { rotate: TransformAngle }
  | { rotateZ: TransformAngle }
  | { skewX: TransformAngle }
  | { skewY: TransformAngle }
  | { rotateX: TransformAngle }
  | { rotateY: TransformAngle }
  | { translateZ: TransformNumber }
  | { perspective: TransformNumber }

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
