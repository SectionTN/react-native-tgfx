// The JS path helpers (asserted numerically) and the path effects (asserted visually).
import React from 'react';
import { describe, expect, render, test } from 'react-native-harness';
import {
  Circle,
  CornerPathEffect,
  DashPathEffect,
  Fill,
  Group,
  Path,
  Rect,
  pathBounds,
  pathContains,
  pathLength,
  pathOp,
  pathPointAtLength,
  pathSegment,
  pathTransform,
} from 'react-native-tgfx';
import { Stage, snapshot } from './testSupport';

const PLATE = 'M10 10 L100 10 L100 100 L10 100 Z';
const DISC =
  'M55 30 C69 30 80 41 80 55 C80 69 69 80 55 80 C41 80 30 69 30 55 C30 41 41 30 55 30 Z';
const ROUTE = 'M12 80 q60 -70 110 0 t100 -10';
const ARCH = 'M20 90 C20 10 100 10 100 90';
const ZIGZAG = 'M10 40 L50 10 L90 40 L130 10 L170 40';

describe('tgfx path helpers', () => {
  test('reports the bounds of a straight-edged path exactly', () => {
    const box = pathBounds(PLATE);
    expect(box.x).toBeCloseTo(10, 3);
    expect(box.y).toBeCloseTo(10, 3);
    expect(box.width).toBeCloseTo(90, 3);
    expect(box.height).toBeCloseTo(90, 3);
  });

  test('tight bounds sit inside the control-point bounds of a curve', () => {
    const loose = pathBounds(ARCH);
    const tight = pathBounds(ARCH, true);
    // The control points reach up to y=10; the ink itself never does.
    expect(tight.y).toBeGreaterThan(loose.y);
    expect(tight.height).toBeLessThan(loose.height);
    expect(tight.x).toBeGreaterThanOrEqual(loose.x);
  });

  test('hit-tests points against the filled region', () => {
    expect(pathContains(PLATE, 55, 55)).toBe(true);
    expect(pathContains(PLATE, 5, 5)).toBe(false);
    expect(pathContains(PLATE, 200, 200)).toBe(false);
  });

  test('punches a hole with a difference op', () => {
    const holed = pathOp(PLATE, DISC, 'difference');
    expect(holed.length).toBeGreaterThan(0);
    // The plate's corner survives; its centre is now the disc's hole.
    expect(pathContains(holed, 15, 15)).toBe(true);
    expect(pathContains(holed, 55, 55)).toBe(false);
  });

  test('intersects and unions two shapes', () => {
    const lens = pathOp(PLATE, DISC, 'intersect');
    const both = pathOp(PLATE, DISC, 'union');
    expect(pathContains(lens, 55, 55)).toBe(true);
    expect(pathContains(lens, 15, 15)).toBe(false);
    expect(pathContains(both, 15, 15)).toBe(true);
    expect(pathContains(both, 55, 55)).toBe(true);
  });

  test('measures a curve and walks along it', () => {
    const length = pathLength(ROUTE);
    expect(length).toBeGreaterThan(0);

    const start = pathPointAtLength(ROUTE, 0);
    expect(start.x).toBeCloseTo(12, 1);
    expect(start.y).toBeCloseTo(80, 1);

    const middle = pathPointAtLength(ROUTE, length / 2);
    expect(middle.x).toBeGreaterThan(start.x);
    expect(Number.isFinite(middle.angle)).toBe(true);

    // Past the end clamps rather than returning NaN.
    const end = pathPointAtLength(ROUTE, length);
    expect(Number.isFinite(end.x)).toBe(true);
    expect(Number.isFinite(end.y)).toBe(true);
  });

  test('cuts a segment shorter than the whole path', () => {
    const length = pathLength(ROUTE);
    const half = pathSegment(ROUTE, 0, length / 2);
    expect(half.length).toBeGreaterThan(0);
    expect(pathLength(half)).toBeLessThan(length);
    expect(pathLength(half)).toBeCloseTo(length / 2, 0);
    // An empty range is an empty path, not a throw.
    expect(pathLength(pathSegment(ROUTE, 0, 0))).toBeCloseTo(0, 3);
  });

  test('applies an affine matrix', () => {
    const moved = pathTransform(PLATE, [1, 0, 0, 1, 20, 5]);
    const box = pathBounds(moved);
    expect(box.x).toBeCloseTo(30, 3);
    expect(box.y).toBeCloseTo(15, 3);
    expect(box.width).toBeCloseTo(90, 3);

    const doubled = pathBounds(pathTransform(PLATE, [2, 0, 0, 2, 0, 0]));
    expect(doubled.width).toBeCloseTo(180, 3);
    expect(doubled.height).toBeCloseTo(180, 3);
  });
});

describe('tgfx path effects', () => {
  test('draws boolean ops', async () => {
    await render(
      <Stage>
        <Fill color="white" />
        <Group transform={[{ scale: 0.62 }]}>
          <Path path={pathOp(PLATE, DISC, 'difference')} color="#4F8EF7" />
          <Group transform={[{ translateX: 115 }]}>
            <Path path={pathOp(PLATE, DISC, 'intersect')} color="#34C759" />
          </Group>
          <Group transform={[{ translateY: 115 }]}>
            <Path path={pathOp(PLATE, DISC, 'union')} color="#AF52DE" />
          </Group>
          <Group transform={[{ translateX: 115 }, { translateY: 115 }]}>
            <Path path={pathOp(PLATE, DISC, 'xor')} color="#FF9500" />
          </Group>
        </Group>
      </Stage>,
    );
    await snapshot('path-boolean-ops');
  });

  test('draws the measured bounds it reports', async () => {
    const tight = pathBounds(ARCH, true);
    const loose = pathBounds(ARCH);
    await render(
      <Stage>
        <Fill color="white" />
        <Group transform={[{ translateX: 40 }, { translateY: 40 }]}>
          <Rect
            x={loose.x}
            y={loose.y}
            width={loose.width}
            height={loose.height}
            color="#C7C7CC"
            style="stroke"
            strokeWidth={1}
          />
          <Rect
            x={tight.x}
            y={tight.y}
            width={tight.width}
            height={tight.height}
            color="#FF9500"
            style="stroke"
            strokeWidth={1}
          />
          <Path path={ARCH} color="#0A84FF" style="stroke" strokeWidth={4} />
        </Group>
      </Stage>,
    );
    await snapshot('path-bounds-tight-vs-loose');
  });

  test('marks a point measured along a curve', async () => {
    const length = pathLength(ROUTE);
    const head = pathPointAtLength(ROUTE, length * 0.6);
    await render(
      <Stage>
        <Fill color="white" />
        <Group transform={[{ translateY: 40 }]}>
          <Path
            path={ROUTE}
            color="#E5E5EA"
            style="stroke"
            strokeWidth={6}
            strokeCap="round"
          />
          <Path
            path={pathSegment(ROUTE, 0, length * 0.6)}
            color="#0A84FF"
            style="stroke"
            strokeWidth={6}
            strokeCap="round"
          />
          <Circle cx={head.x} cy={head.y} r={7} color="#FF3B30" />
        </Group>
      </Stage>,
    );
    await snapshot('path-point-at-length');
  });

  test('dashes a stroke', async () => {
    await render(
      <Stage>
        <Fill color="white" />
        <Group transform={[{ translateY: 20 }]}>
          <Path path={ZIGZAG} color="#1C1C1E" style="stroke" strokeWidth={4}>
            <DashPathEffect intervals={[12, 8]} />
          </Path>
        </Group>
        {/* The same dashes, shifted half a period by the phase. */}
        <Group transform={[{ translateY: 110 }]}>
          <Path path={ZIGZAG} color="#0A84FF" style="stroke" strokeWidth={4}>
            <DashPathEffect intervals={[12, 8]} phase={10} />
          </Path>
        </Group>
      </Stage>,
    );
    await snapshot('path-dash-effect');
  });

  test('rounds corners before stroking', async () => {
    await render(
      <Stage>
        <Fill color="white" />
        <Group transform={[{ translateY: 20 }]}>
          <Path path={ZIGZAG} color="#8E8E93" style="stroke" strokeWidth={4} />
        </Group>
        <Group transform={[{ translateY: 110 }]}>
          <Path path={ZIGZAG} color="#FF9500" style="stroke" strokeWidth={4}>
            <CornerPathEffect r={20} />
          </Path>
        </Group>
      </Stage>,
    );
    await snapshot('path-corner-effect');
  });

  test('trims a stroke with start and end', async () => {
    const ring =
      'M100 20 C144 20 180 56 180 100 C180 144 144 180 100 180 C56 180 20 144 20 100 C20 56 56 20 100 20 Z';
    await render(
      <Stage>
        <Fill color="white" />
        <Path path={ring} color="#E5E5EA" style="stroke" strokeWidth={10} />
        <Path
          path={ring}
          color="#34C759"
          style="stroke"
          strokeWidth={10}
          strokeCap="round"
          start={0.1}
          end={0.65}
        />
      </Stage>,
    );
    await snapshot('path-trim');
  });
});
