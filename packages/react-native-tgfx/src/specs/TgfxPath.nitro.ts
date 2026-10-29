import type { HybridObject } from 'react-native-nitro-modules'

/** An axis-aligned box, in the same units the path data is written in. */
export interface PathBounds {
  x: number
  y: number
  width: number
  height: number
}

/** A point on a path plus the unit tangent there, for placing a marker along a route. */
export interface PathPoint {
  x: number
  y: number
  /** Radians, measured the way `Math.atan2` measures: 0 points along +x. */
  angle: number
}

/**
 * Path geometry, string in and string out. Every method parses SVG path data,
 * hands it to the tgfx geometry the renderer already uses, and serialises the
 * result back - so a path built here draws identically in `<Path path>`.
 */
export interface TgfxPath extends HybridObject<{
  ios: 'c++'
  android: 'c++'
}> {
  /**
   * Combine two paths. `op` is `'union'`, `'difference'` (b removed from a),
   * `'intersect'` or `'xor'`. An unknown op appends, matching tgfx's default.
   */
  op(a: string, b: string, op: string): string

  /**
   * The path's bounding box. `tight` costs a full curve evaluation and returns
   * the box the ink actually occupies; without it the control points bound it,
   * which is cheaper and never smaller.
   */
  bounds(path: string, tight: boolean): PathBounds

  /** Whether the point is inside the path, under the winding fill `parseSvgPath` gives it. */
  contains(path: string, x: number, y: number): boolean

  /** Apply an affine matrix, in the `[a, b, c, d, tx, ty]` order `Matrix::MakeAll` takes. */
  transform(path: string, matrix: number[]): string

  /** Total length of every contour, in path units. */
  length(path: string): number

  /** The point `distance` along the path, clamped to `[0, length]`. */
  pointAtLength(path: string, distance: number): PathPoint

  /**
   * The piece of the path between two distances, as its own path. Empty when
   * `start >= stop` or the path has no length - the same cases tgfx refuses.
   */
  segment(path: string, start: number, stop: number): string
}
