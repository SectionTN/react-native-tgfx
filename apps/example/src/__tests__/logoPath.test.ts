import { ICON, ICON_AMPLITUDE } from '../iconPath';
import { AMPLITUDE, JELLYFISH, OPS, PTS, WAVE_TOP } from '../logoPath';
import { wavePath, type WaveShape } from '../logoWave';

function numbersOf(path: string) {
  return path.match(/-?\d+(\.\d+)?/g)!.map(Number);
}

const SHAPES: [string, WaveShape, number][] = [
  ['jellyfish', JELLYFISH, AMPLITUDE],
  ['icon', ICON, ICON_AMPLITUDE],
];

test('every segment consumes exactly the points it declares', () => {
  const consumed = [...OPS].reduce((n, op) => n + (op === 'M' ? 1 : op === 'C' ? 3 : 0), 0);
  expect(consumed * 2).toBe(PTS.length);
});

test('the bell holds still and the tentacles travel', () => {
  const still = numbersOf(wavePath(JELLYFISH, 0, AMPLITUDE));
  const later = numbersOf(wavePath(JELLYFISH, Math.PI / 2, AMPLITUDE));
  expect(still).toHaveLength(PTS.length);
  expect(still.every(Number.isFinite)).toBe(true);

  const above: number[] = [];
  const below: number[] = [];
  for (let i = 0; i < PTS.length; i += 2) {
    const drift = Math.abs(still[i]! - later[i]!);
    ((PTS[i + 1] as number) <= WAVE_TOP ? above : below).push(drift);
  }
  expect(Math.max(...above)).toBe(0);
  expect(Math.max(...below)).toBeGreaterThan(1);
});

describe.each(SHAPES)('%s', (_name, shape, amplitude) => {
  test('the loop is seamless — 2pi lands back on the shape it started from', () => {
    // An overtone at a fractional rate restarts on a different shape, which reads
    // as a flicker at the wrap.
    expect(wavePath(shape, Math.PI * 2, amplitude)).toBe(wavePath(shape, 0, amplitude));
  });

  test('it moves, and its anchored end does not', () => {
    expect(wavePath(shape, Math.PI / 2, amplitude)).not.toBe(wavePath(shape, 0, amplitude));
    expect(Math.min(...shape.ramp)).toBeGreaterThan(0);
    expect(Math.max(...shape.ramp)).toBeLessThanOrEqual(1);
  });

  test('the resting shape is a closed path with no displacement', () => {
    expect(shape.rest.startsWith('M')).toBe(true);
    expect(shape.rest.trimEnd().endsWith('Z')).toBe(true);
    expect(numbersOf(shape.rest).every(Number.isFinite)).toBe(true);
  });
});

test('the jellyfish at rest carries every original point', () => {
  const drawn = numbersOf(JELLYFISH.rest);
  expect(drawn).toHaveLength(PTS.length);
  for (let i = 0; i < PTS.length; i++) {
    expect(drawn[i]).toBeCloseTo(PTS[i] as number, 2);
  }
});
