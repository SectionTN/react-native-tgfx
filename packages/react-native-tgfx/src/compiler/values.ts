/**
 * Reanimated value interop used by the compiler.
 *
 * A value passed to a drawing prop can be a plain JS value or a Reanimated
 * `SharedValue`. SharedValues are detected structurally (the same brand check
 * Reanimated and react-native-skia use) so this package never has to import
 * Reanimated, keeping it an optional peer dependency.
 *
 * In the static compile path here we read `.value` to take a snapshot. The
 * zero-JS-per-frame animation path (the Reanimated driver) instead allocates a
 * value slot for each SharedValue and patches it natively on the UI thread.
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

/** An animated value slot placeholder emitted into the scene JSON. */
export interface Slot {
  __s: number
}

/**
 * Assigns a stable slot index to each distinct SharedValue encountered while
 * compiling a scene, so the native side can resolve `{ __s }` placeholders
 * against the per-frame values array.
 */
export class SlotAllocator {
  readonly values: MaybeSharedValue<unknown>[] = []
  private readonly map = new Map<object, number>()

  slot(sv: MaybeSharedValue<unknown>): number {
    const existing = this.map.get(sv as object)
    if (existing != null) {
      return existing
    }
    const index = this.values.length
    this.values.push(sv)
    this.map.set(sv as object, index)
    return index
  }
}

/**
 * Resolve a numeric prop to either a literal number (static) or a `{ __s }` slot
 * placeholder (animated SharedValue) so animation flows through the values array.
 */
export function num(
  v: unknown,
  alloc: SlotAllocator,
  fallback = 0
): number | Slot {
  if (isSharedValue(v)) {
    return { __s: alloc.slot(v) }
  }
  return resolveNumber(v, fallback)
}
