// Every drawing primitive, in both paint styles, plus the stroke geometry knobs.
import React from 'react';
import { describe, render, test } from 'react-native-harness';
import {
  Circle,
  Fill,
  Group,
  Line,
  Oval,
  Path,
  Rect,
  RoundedRect,
  type BlendMode,
} from 'react-native-tgfx';
import { Stage, snapshot } from './testSupport';

// A square with a square hole: winding keeps it solid, evenOdd punches it out.
const DONUT = 'M20 20 L120 20 L120 120 L20 120 Z M50 50 L90 50 L90 90 L50 90 Z';

describe('tgfx shapes', () => {
  test('fills every primitive', async () => {
    await render(
      <Stage>
        <Fill color="white" />
        <Rect x={10} y={10} width={80} height={50} color="#4F8EF7" />
        <RoundedRect
          x={106}
          y={10}
          width={80}
          height={50}
          r={16}
          color="#34C759"
        />
        <Circle cx={50} cy={110} r={36} color="#FF9500" />
        <Oval x={100} y={78} width={90} height={64} color="#AF52DE" />
        <Line
          x1={12}
          y1={165}
          x2={188}
          y2={165}
          color="#1C1C1E"
          style="stroke"
          strokeWidth={6}
        />
        <Path path="M12 190 q44 -26 88 0 t88 0" color="#5856D6" />
      </Stage>,
    );
    await snapshot('shapes-primitives-fill');
  });

  test('strokes every primitive', async () => {
    await render(
      <Stage>
        <Fill color="white" />
        <Rect
          x={10}
          y={10}
          width={80}
          height={50}
          color="#4F8EF7"
          style="stroke"
          strokeWidth={5}
        />
        <RoundedRect
          x={106}
          y={10}
          width={80}
          height={50}
          r={16}
          color="#34C759"
          style="stroke"
          strokeWidth={5}
        />
        <Circle
          cx={50}
          cy={110}
          r={36}
          color="#FF9500"
          style="stroke"
          strokeWidth={5}
        />
        <Oval
          x={100}
          y={78}
          width={90}
          height={64}
          color="#AF52DE"
          style="stroke"
          strokeWidth={5}
        />
        <Path
          path="M12 190 q44 -26 88 0 t88 0"
          color="#5856D6"
          style="stroke"
          strokeWidth={5}
        />
      </Stage>,
    );
    await snapshot('shapes-primitives-stroke');
  });

  test('applies every stroke cap', async () => {
    const caps = ['butt', 'round', 'square'] as const;
    await render(
      <Stage>
        <Fill color="white" />
        {caps.map((cap, i) => (
          <Line
            key={cap}
            x1={40}
            y1={40 + i * 60}
            x2={160}
            y2={40 + i * 60}
            color="#0A84FF"
            style="stroke"
            strokeWidth={22}
            strokeCap={cap}
          />
        ))}
        {/* Hairlines at the nominal ends: only 'butt' stops on them. */}
        {caps.map((cap, i) => (
          <Line
            key={`tick-${cap}`}
            x1={40}
            y1={12 + i * 60}
            x2={40}
            y2={68 + i * 60}
            color="#FF3B30"
            style="stroke"
            strokeWidth={1}
          />
        ))}
      </Stage>,
    );
    await snapshot('shapes-stroke-caps');
  });

  test('applies every stroke join', async () => {
    const joins = ['miter', 'round', 'bevel'] as const;
    await render(
      <Stage>
        <Fill color="white" />
        {joins.map((join, i) => (
          <Path
            key={join}
            path={`M20 ${52 + i * 62} L60 ${16 + i * 62} L100 ${52 + i * 62}`}
            color="#FF9500"
            style="stroke"
            strokeWidth={18}
            strokeJoin={join}
          />
        ))}
      </Stage>,
    );
    await snapshot('shapes-stroke-joins');
  });

  test('cuts a miter back at the limit', async () => {
    await render(
      <Stage>
        <Fill color="white" />
        {[1, 20].map((limit, i) => (
          <Path
            key={limit}
            path={`M${20 + i * 100} 150 L${52 + i * 100} 40 L${
              84 + i * 100
            } 150`}
            color="#FF3B30"
            style="stroke"
            strokeWidth={16}
            strokeJoin="miter"
            strokeMiter={limit}
          />
        ))}
      </Stage>,
    );
    await snapshot('shapes-miter-limit');
  });

  test('honours fillType on a self-overlapping path', async () => {
    await render(
      <Stage>
        <Fill color="white" />
        {/* Half scale so both copies fit side by side. */}
        <Path path={DONUT} color="#5856D6" />
        <Group transform={[{ translateX: 60 }, { translateY: 60 }]}>
          <Path path={DONUT} color="#FF2D55" fillType="evenOdd" />
        </Group>
      </Stage>,
    );
    await snapshot('shapes-path-filltype');
  });

  test('composites a shape with each blend mode', async () => {
    const modes: BlendMode[] = ['srcOver', 'multiply', 'screen', 'difference'];
    await render(
      <Stage>
        <Fill color="white" />
        {modes.map((mode, i) => (
          <Circle
            key={`under-${mode}`}
            cx={52 + (i % 2) * 96}
            cy={52 + Math.floor(i / 2) * 96}
            r={30}
            color="#f2a33c"
          />
        ))}
        {modes.map((mode, i) => (
          <Circle
            key={mode}
            cx={72 + (i % 2) * 96}
            cy={52 + Math.floor(i / 2) * 96}
            r={30}
            color="#4f8ef7"
            blendMode={mode}
          />
        ))}
      </Stage>,
    );
    await snapshot('shapes-blend-modes');
  });

  test('fills the whole stage with <Fill>', async () => {
    await render(
      <Stage>
        <Fill color="#0A84FF" />
      </Stage>,
    );
    await snapshot('shapes-fill-node');
  });
});
