// The wave that runs on the UI thread, shared by the logos in ./logoPath and
// ./iconPath. A path is flattened to absolute segments once; only the points
// below the wave line move, and only in x.

/** One letter per segment: `M` and `L` consume one point, `C` three, `Z` none. */
export type Ops = string;

export interface WaveShape {
  /** Literal text either side of every moving x, so a frame only formats what moves. */
  chunks: string[];
  /** Resting x of each moving point, in the order the chunks expect it back. */
  baseX: number[];
  /** Its share of the amplitude: 0 at the anchored end, 1 at the loose one. */
  ramp: number[];
  /** Its two wave arguments, less the phase — the part that never changes. */
  a1: number[];
  a2: number[];
  /** The shape at rest, for a draw-on trace. */
  rest: string;
}

export interface WaveOptions {
  /** Nothing above this line moves. */
  top: number;
  /** Full strength here, at the loose end. */
  bottom: number;
  /** Radians per unit of height — how many crests fit along the shape. */
  wavelength: number;
  /** The second harmonic, so an edge bends in an S rather than swinging as one bar. */
  overtone: number;
}

// Whole number: the overtone has to come back to where it started after a 2π
// phase, or the loop restarts on a different shape and the wrap reads as a flicker.
const OVERTONE_RATE = 2;
const OVERTONE_MIX = 0.35;

function pointsFor(op: string): number {
  return op === 'C' ? 3 : op === 'Z' ? 0 : 1;
}

/** Splits a flattened path into the fixed text and the points the wave moves. */
export function buildWave(ops: Ops, pts: number[], o: WaveOptions): WaveShape {
  const chunks: string[] = [];
  const baseX: number[] = [];
  const ramp: number[] = [];
  const a1: number[] = [];
  const a2: number[] = [];
  let text = '';
  let i = 0;

  for (let s = 0; s < ops.length; s++) {
    const op = ops[s] as string;
    if (op === 'Z') {
      text += 'Z ';
      continue;
    }
    text += op;
    const points = pointsFor(op);
    for (let k = 0; k < points; k++) {
      const x = pts[i] as number;
      const y = pts[i + 1] as number;
      i += 2;
      const t = (y - o.top) / (o.bottom - o.top);
      const r = t <= 0 ? 0 : t >= 1 ? 1 : t * t;
      if (r === 0) {
        text += ' ' + x + ' ' + y;
      } else {
        chunks.push(text + ' ');
        text = ' ' + y;
        baseX.push(x);
        ramp.push(r);
        a1.push(y * o.wavelength);
        a2.push(y * o.overtone);
      }
    }
    text += ' ';
  }
  chunks.push(text);

  const shape: WaveShape = { chunks, baseX, ramp, a1, a2, rest: '' };
  shape.rest = wavePath(shape, 0, 0);
  return shape;
}

/**
 * The shape with every point below the wave line pushed sideways by a wave that
 * travels *down* it — the sign on `phase` is what sends the crest from the
 * anchored end to the loose one rather than the shape sliding through a fixed field.
 *
 * The displacement is a function of height alone, so both edges of a strand at
 * the same height move together and its width is preserved. Anything that varies
 * across a strand (an x term, a vertical term) pinches and tears it instead.
 */
export function wavePath(shape: WaveShape, phase: number, amplitude: number): string {
  'worklet';
  const { chunks, baseX, ramp, a1, a2 } = shape;
  let out = chunks[0] as string;
  for (let m = 0; m < baseX.length; m++) {
    const wave =
      Math.sin((a1[m] as number) - phase) +
      OVERTONE_MIX * Math.sin((a2[m] as number) - OVERTONE_RATE * phase);
    out +=
      ((baseX[m] as number) + (ramp[m] as number) * amplitude * wave * 0.74).toFixed(2) +
      (chunks[m + 1] as string);
  }
  return out;
}
