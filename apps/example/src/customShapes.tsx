// Custom and procedural shapes built on tgfx primitives; the reconciler expands them like any React.
import { type ReactElement } from 'react';
import { Circle, Group, Path, RoundedRect } from 'react-native-tgfx';

type Paint = {
  color?: string;
  style?: 'fill' | 'stroke';
  strokeWidth?: number;
  strokeJoin?: 'miter' | 'round' | 'bevel';
  strokeCap?: 'butt' | 'round' | 'square';
  opacity?: number;
};


export function starPath(
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  points = 5
): string {
  const step = Math.PI / points;
  let d = '';
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = step * i - Math.PI / 2;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)} `;
  }
  return d + 'Z';
}

export function polygonPath(
  cx: number,
  cy: number,
  r: number,
  sides: number,
  rotation = -Math.PI / 2
): string {
  let d = '';
  for (let i = 0; i < sides; i++) {
    const a = rotation + (2 * Math.PI * i) / sides;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)} `;
  }
  return d + 'Z';
}

export function heartPath(cx: number, cy: number, size: number): string {
  const s = size;
  const top = cy - s * 0.25;
  return (
    `M${cx} ${cy + s * 0.45} ` +
    `C ${cx - s} ${cy - s * 0.1}, ${cx - s * 0.55} ${top - s * 0.7}, ${cx} ${top} ` +
    `C ${cx + s * 0.55} ${top - s * 0.7}, ${cx + s} ${cy - s * 0.1}, ${cx} ${cy + s * 0.45} Z`
  );
}

export function wavePath(
  x: number,
  y: number,
  width: number,
  amplitude: number,
  wavelength: number
): string {
  let d = `M${x} ${y.toFixed(2)} `;
  const steps = Math.max(2, Math.round(width / 4));
  for (let i = 1; i <= steps; i++) {
    const px = x + (width * i) / steps;
    const py = y + amplitude * Math.sin(((px - x) / wavelength) * Math.PI * 2);
    d += `L${px.toFixed(2)} ${py.toFixed(2)} `;
  }
  return d;
}


export function Star(
  props: { cx: number; cy: number; outerR: number; innerR?: number; points?: number } & Paint
): ReactElement {
  const { cx, cy, outerR, innerR, points = 5, ...paint } = props;
  return <Path path={starPath(cx, cy, outerR, innerR ?? outerR * 0.45, points)} {...paint} />;
}

export function RegularPolygon(
  props: { cx: number; cy: number; r: number; sides: number } & Paint
): ReactElement {
  const { cx, cy, r, sides, ...paint } = props;
  return <Path path={polygonPath(cx, cy, r, sides)} {...paint} />;
}

export function Heart(props: { cx: number; cy: number; size: number } & Paint): ReactElement {
  const { cx, cy, size, ...paint } = props;
  return <Path path={heartPath(cx, cy, size)} {...paint} />;
}

export function Wave(
  props: { x: number; y: number; width: number; amplitude?: number; wavelength?: number } & Paint
): ReactElement {
  const { x, y, width, amplitude = 10, wavelength = 48, ...paint } = props;
  return <Path path={wavePath(x, y, width, amplitude, wavelength)} style="stroke" {...paint} />;
}


/** A grid of circles tinted across the HSL hue wheel. */
export function CircleField(props: {
  x: number;
  y: number;
  cols: number;
  rows: number;
  cell: number;
  radius?: number;
}): ReactElement {
  const { x, y, cols, rows, cell, radius = cell * 0.36 } = props;
  const items: ReactElement[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const hue = (((c / cols) * 300 + (r / rows) * 120) % 360).toFixed(0);
      items.push(
        <Circle
          key={`${r}-${c}`}
          cx={x + c * cell + cell / 2}
          cy={y + r * cell + cell / 2}
          r={radius}
          color={`hsl(${hue}, 85%, 60%)`}
        />
      );
    }
  }
  return <Group>{items}</Group>;
}

/** A golden-angle phyllotaxis spiral of dots (sunflower pattern). */
export function Spiral(props: {
  cx: number;
  cy: number;
  count: number;
  spacing: number;
  dotR?: number;
}): ReactElement {
  const { cx, cy, count, spacing, dotR = 3 } = props;
  const golden = Math.PI * (3 - Math.sqrt(5));
  const items: ReactElement[] = [];
  for (let i = 0; i < count; i++) {
    const a = i * golden;
    const rr = spacing * Math.sqrt(i);
    items.push(
      <Circle
        key={i}
        cx={cx + rr * Math.cos(a)}
        cy={cy + rr * Math.sin(a)}
        r={dotR}
        color={`hsl(${((i * 7) % 360).toFixed(0)}, 75%, 55%)`}
      />
    );
  }
  return <Group>{items}</Group>;
}

/** A rounded-bar chart from a data array. */
export function BarChart(props: {
  x: number;
  y: number;
  width: number;
  height: number;
  data: number[];
}): ReactElement {
  const { x, y, width, height, data } = props;
  const max = Math.max(1, ...data);
  const bw = width / data.length;
  return (
    <Group>
      {data.map((v, i) => {
        const bh = (v / max) * height;
        return (
          <RoundedRect
            key={i}
            x={x + i * bw + 3}
            y={y + height - bh}
            width={bw - 6}
            height={bh}
            r={4}
            color={`hsl(${(205 + i * 14).toFixed(0)}, 70%, 55%)`}
          />
        );
      })}
    </Group>
  );
}