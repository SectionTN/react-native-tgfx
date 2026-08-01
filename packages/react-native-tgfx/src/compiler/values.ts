/**
 * Reanimated value interop used by the compiler.
 *
 * A value passed to a drawing prop can be a plain JS value or a Reanimated
 * `SharedValue`. SharedValues are detected structurally (the same brand check
 * Reanimated and react-native-skia use) so this package never has to import
 * Reanimated, keeping it an optional peer dependency.
 *
 * In the static compile path here we read `.value` to take a snapshot. The
 * zero-JS-per-frame animation path (the Reanimated driver) instead has the
 * scene writer allocate a value slot for each SharedValue, which the native
 * engine patches on the UI thread.
 */
export interface MaybeSharedValue<T> {
  value: T
  _isReanimatedSharedValue?: true
}

export function isSharedValue(v: unknown): v is MaybeSharedValue<unknown> {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as { _isReanimatedSharedValue?: unknown })._isReanimatedSharedValue ===
      true
  )
}

/** Unwrap a possibly-shared value to its current concrete value. */
export function resolveValue<T>(v: T | MaybeSharedValue<T>): T {
  if (isSharedValue(v)) {
    return v.value as T
  }
  return v as T
}

/** Unwrap to a finite number, falling back to `fallback` for nullish input. */
export function resolveNumber(v: unknown, fallback = 0): number {
  const raw = isSharedValue(v) ? v.value : v
  if (raw == null) {
    return fallback
  }
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}
