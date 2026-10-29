import { NitroModules } from 'react-native-nitro-modules'
import type { PathBounds, PathPoint, TgfxPath } from '../specs/TgfxPath.nitro'

let manager: TgfxPath | null = null
function paths(): TgfxPath {
  manager ??= NitroModules.createHybridObject<TgfxPath>('TgfxPath')
  return manager
}

export type { PathBounds, PathPoint } from '../specs/TgfxPath.nitro'

/** How two paths combine. Anything else appends, which is tgfx's own default. */
export type PathOp = 'union' | 'difference' | 'intersect' | 'xor'

/** A 2D affine matrix in `[a, b, c, d, tx, ty]` order, as SVG and CSS write it. */
export type PathMatrix = [number, number, number, number, number, number]

/**
 * Combine two paths. `'difference'` removes `b` from `a`; the rest are
 * symmetric. Punches a hole without the offscreen layer a `<Mask>` would cost.
 */
export function pathOp(a: string, b: string, op: PathOp): string {
  return paths().op(a, b, op)
}

/**
 * The path's bounding box. `tight` evaluates the curves and returns the box the
 * ink actually fills; the default bounds the control points, which is cheaper
 * and never smaller.
 */
export function pathBounds(path: string, tight = false): PathBounds {
  return paths().bounds(path, tight)
}

/** Whether the point falls inside the path, under non-zero winding - what `<Path>` draws. */
export function pathContains(path: string, x: number, y: number): boolean {
  return paths().contains(path, x, y)
}

/** Apply an affine matrix and return the transformed path data. */
export function pathTransform(path: string, matrix: PathMatrix): string {
  return paths().transform(path, matrix)
}

/** Total length of every contour, in the units the path data is written in. */
export function pathLength(path: string): number {
  return paths().length(path)
}

/**
 * The point `distance` along the path, with the tangent there as an angle in
 * radians - enough to place and rotate a marker on a route.
 */
export function pathPointAtLength(path: string, distance: number): PathPoint {
  return paths().pointAtLength(path, distance)
}

/**
 * The piece of the path between two distances, as its own path. Empty when
 * `start >= stop`, which is what tgfx refuses rather than guesses at.
 */
export function pathSegment(path: string, start: number, stop: number): string {
  return paths().segment(path, start, stop)
}
