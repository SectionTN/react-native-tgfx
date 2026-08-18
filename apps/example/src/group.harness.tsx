// <Group>: transforms, clipping, layers, recorded pictures — and <Mask> on top of them.
import React from 'react';
import { describe, render, test } from 'react-native-harness';
import {
  Circle,
  Fill,
  Group,
  LinearGradient,
  Line,
  Mask,
  Rect,
  RoundedRect,
} from 'react-native-tgfx';
import { Stage, snapshot } from './testSupport';

const BLOB =
  'M100 20 C150 20 180 60 180 100 C180 140 150 180 100 180 C50 180 20 140 20 100 C20 60 50 20 100 20 Z';

describe('tgfx groups', () => {
  test('applies each transform op', async () => {
    await render(
      <Stage>
        <Fill color="white" />
        <Group transform={[{ translateX: 20 }, { translateY: 10 }]}>
          <Rect x={0} y={0} width={60} height={40} color="#4F8EF7" />
        </Group>
        <Group
          transform={[{ translateX: 110 }, { translateY: 10 }, { scale: 1.4 }]}
        >
          <Rect x={0} y={0} width={40} height={28} color="#34C759" />
        </Group>
        <Group
          transform={[
            { translateX: 50 },
            { translateY: 110 },
            { rotate: '25deg' },
          ]}
        >
          <Rect x={-30} y={-20} width={60} height={40} color="#FF9500" />
        </Group>
        <Group
          transform={[{ translateX: 150 }, { translateY: 110 }, { skewX: 0.4 }]}
        >
          <Rect x={-25} y={-20} width={50} height={40} color="#AF52DE" />
        </Group>
      </Stage>,
    );
    await snapshot('group-transforms');
  });

  test('rotates about an explicit origin', async () => {
    await render(
      <Stage>
        <Fill color="white" />
        {/* Same rect, same angle: only the pivot differs. */}
        <Rect x={70} y={70} width={60} height={60} color="#E5E5EA" />
        <Group transform={[{ rotate: '30deg' }]} origin={{ x: 100, y: 100 }}>
          <Rect
            x={70}
            y={70}
            width={60}
            height={60}
            color="#0A84FF"
            opacity={0.7}
          />
        </Group>
        <Group transform={[{ rotate: '30deg' }]} origin={{ x: 0, y: 0 }}>
          <Rect
            x={70}
            y={70}
            width={60}
            height={60}
            color="#FF3B30"
            opacity={0.7}
          />
        </Group>
      </Stage>,
    );
    await snapshot('group-transform-origin');
  });

  test('clips a subtree to a rect, a rounded rect and a path', async () => {
    await render(
      <Stage>
        <Fill color="white" />
        <Group clip={{ x: 6, y: 6, width: 56, height: 88 }}>
          <Circle cx={34} cy={50} r={44} color="#4F8EF7" />
        </Group>
        <Group clip={{ x: 72, y: 6, width: 56, height: 88, r: 20 }}>
          <Circle cx={100} cy={50} r={44} color="#34C759" />
        </Group>
        <Group clip={BLOB} transform={[{ translateY: 100 }, { scale: 0.5 }]}>
          <Rect x={0} y={0} width={400} height={400} color="#FF9500" />
        </Group>
      </Stage>,
    );
    await snapshot('group-clip');
  });

  test('keeps the complement with invertClip', async () => {
    await render(
      <Stage>
        <Fill color="white" />
        <Group clip={{ x: 60, y: 60, width: 80, height: 80, r: 20 }} invertClip>
          <Rect x={0} y={0} width={200} height={200} color="#5856D6" />
        </Group>
      </Stage>,
    );
    await snapshot('group-invert-clip');
  });

  test('blends an overlap once under layer', async () => {
    await render(
      <Stage>
        <Fill color="white" />
        {/* Left: one offscreen composite, so the overlap stays flat. */}
        <Group layer opacity={0.5}>
          <Circle cx={55} cy={60} r={38} color="#4F8EF7" />
          <Circle cx={95} cy={60} r={38} color="#4F8EF7" />
        </Group>
        {/* Right: opacity multiplies per child, so the overlap darkens. */}
        <Group opacity={0.5} transform={[{ translateY: 90 }]}>
          <Circle cx={55} cy={60} r={38} color="#4F8EF7" />
          <Circle cx={95} cy={60} r={38} color="#4F8EF7" />
        </Group>
      </Stage>,
    );
    await snapshot('group-layer');
  });

  test('replays a recorded picture', async () => {
    await render(
      <Stage>
        <Fill color="white" />
        <Group picture>
          {[0, 1, 2, 3, 4, 5].map(i => (
            <Line
              key={`v${i}`}
              x1={10 + i * 36}
              y1={10}
              x2={10 + i * 36}
              y2={190}
              color="#d1d1d6"
              strokeWidth={1}
              style="stroke"
            />
          ))}
          {[0, 1, 2, 3, 4, 5].map(i => (
            <Line
              key={`h${i}`}
              x1={10}
              y1={10 + i * 36}
              x2={190}
              y2={10 + i * 36}
              color="#d1d1d6"
              strokeWidth={1}
              style="stroke"
            />
          ))}
        </Group>
      </Stage>,
    );
    await snapshot('group-picture');
  });

  test('hides a subtree through visible', async () => {
    await render(
      <Stage>
        <Fill color="white" />
        <Group visible={false}>
          <Rect x={0} y={0} width={200} height={100} color="#FF3B30" />
        </Group>
        <Group visible={true}>
          <Rect x={0} y={100} width={200} height={100} color="#34C759" />
        </Group>
      </Stage>,
    );
    await snapshot('group-visible');
  });

  test('masks by alpha and by luminance', async () => {
    await render(
      <Stage>
        <Fill color="white" />
        <Mask
          mode="alpha"
          mask={<Circle cx={55} cy={55} r={45} color="black" />}
        >
          <Rect x={0} y={0} width={110} height={110} color="#0A84FF" />
        </Mask>
        {/* A white-to-black ramp: luminance fades the masked fill out to the right. */}
        <Mask
          mode="luminance"
          mask={
            <Rect x={0} y={110} width={200} height={90}>
              <LinearGradient
                start={{ x: 0, y: 0 }}
                end={{ x: 200, y: 0 }}
                colors={['#ffffff', '#000000']}
              />
            </Rect>
          }
        >
          <RoundedRect
            x={0}
            y={110}
            width={200}
            height={90}
            r={12}
            color="#FF2D55"
          />
        </Mask>
      </Stage>,
    );
    await snapshot('group-mask');
  });
});
