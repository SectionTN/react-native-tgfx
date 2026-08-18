// Everything that can hang off a paint: gradients, colour filters, image filters, noise.
import React from 'react';
import { describe, render, test } from 'react-native-harness';
import {
  Blend,
  BlendColor,
  Blur,
  Circle,
  ColorMatrix,
  ColorShader,
  DiamondGradient,
  DropShadow,
  Fill,
  FractalNoise,
  LinearGradient,
  Luma,
  Paint,
  Path,
  RadialGradient,
  Rect,
  RoundedRect,
  SweepGradient,
  Turbulence,
} from 'react-native-tgfx';
import { Stage, snapshot } from './testSupport';

const GREYSCALE = [
  0.213, 0.715, 0.072, 0, 0, 0.213, 0.715, 0.072, 0, 0, 0.213, 0.715, 0.072, 0,
  0, 0, 0, 0, 1, 0,
];

// Red and blue swapped, so a wrong channel order fails loudly rather than subtly.
const CHANNEL_SWAP = [
  0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0,
];

describe('tgfx paint', () => {
  test('draws all four gradient kinds', async () => {
    await render(
      <Stage>
        <Fill color="white" />
        <Rect x={4} y={4} width={92} height={92}>
          <LinearGradient
            start={{ x: 4, y: 4 }}
            end={{ x: 96, y: 96 }}
            colors={['#FF6CAB', '#7366FF']}
          />
        </Rect>
        <Rect x={104} y={4} width={92} height={92}>
          <RadialGradient
            center={{ x: 150, y: 50 }}
            r={46}
            colors={['#FFE259', '#FFA751']}
          />
        </Rect>
        <Rect x={4} y={104} width={92} height={92}>
          <SweepGradient
            c={{ x: 50, y: 150 }}
            colors={['#11998e', '#38ef7d', '#11998e']}
          />
        </Rect>
        <Rect x={104} y={104} width={92} height={92}>
          <DiamondGradient
            center={{ x: 150, y: 150 }}
            r={46}
            colors={['#0A84FF', '#001E3C']}
          />
        </Rect>
      </Stage>,
    );
    await snapshot('paint-gradients');
  });

  test('places gradient stops at explicit positions', async () => {
    await render(
      <Stage>
        <Fill color="white" />
        <Rect x={10} y={10} width={180} height={80}>
          <LinearGradient
            start={{ x: 10, y: 0 }}
            end={{ x: 190, y: 0 }}
            colors={['#FF3B30', '#FFD60A', '#34C759']}
          />
        </Rect>
        {/* Same three colours, but the yellow is crushed into the last 10%. */}
        <Rect x={10} y={110} width={180} height={80}>
          <LinearGradient
            start={{ x: 10, y: 0 }}
            end={{ x: 190, y: 0 }}
            colors={['#FF3B30', '#FFD60A', '#34C759']}
            positions={[0, 0.9, 1]}
          />
        </Rect>
      </Stage>,
    );
    await snapshot('paint-gradient-positions');
  });

  test('fills a shape with a flat colour shader', async () => {
    await render(
      <Stage>
        <Fill color="white" />
        <Circle cx={100} cy={100} r={80}>
          <ColorShader color="#AF52DE" />
        </Circle>
      </Stage>,
    );
    await snapshot('paint-color-shader');
  });

  test('folds two shaders together with <Blend>', async () => {
    await render(
      <Stage>
        <Fill color="white" />
        <Rect x={10} y={10} width={180} height={180}>
          <Blend mode="multiply">
            <LinearGradient
              start={{ x: 10, y: 10 }}
              end={{ x: 190, y: 10 }}
              colors={['#ffffff', '#0A84FF']}
            />
            <LinearGradient
              start={{ x: 10, y: 10 }}
              end={{ x: 10, y: 190 }}
              colors={['#ffffff', '#FF9500']}
            />
          </Blend>
        </Rect>
      </Stage>,
    );
    await snapshot('paint-blend-shaders');
  });

  test('applies colour matrices', async () => {
    await render(
      <Stage>
        <Fill color="white" />
        <Rect x={10} y={10} width={180} height={54}>
          <LinearGradient
            start={{ x: 10, y: 0 }}
            end={{ x: 190, y: 0 }}
            colors={['#FF3B30', '#34C759', '#0A84FF']}
          />
        </Rect>
        <Rect x={10} y={73} width={180} height={54}>
          <Paint>
            <LinearGradient
              start={{ x: 10, y: 0 }}
              end={{ x: 190, y: 0 }}
              colors={['#FF3B30', '#34C759', '#0A84FF']}
            />
            <ColorMatrix matrix={GREYSCALE} />
          </Paint>
        </Rect>
        <Rect x={10} y={136} width={180} height={54}>
          <Paint>
            <LinearGradient
              start={{ x: 10, y: 0 }}
              end={{ x: 190, y: 0 }}
              colors={['#FF3B30', '#34C759', '#0A84FF']}
            />
            <ColorMatrix matrix={CHANNEL_SWAP} />
          </Paint>
        </Rect>
      </Stage>,
    );
    await snapshot('paint-color-matrix');
  });

  test('tints through <BlendColor>', async () => {
    await render(
      <Stage>
        <Fill color="#dfe4ec" />
        <Path path="M50 10 L92 52 L50 94 L8 52 Z" color="#ffffff" />
        <Path path="M150 10 L192 52 L150 94 L108 52 Z" color="#ffffff">
          <BlendColor color="#e0533d" mode="src" />
        </Path>
        <Path path="M50 110 L92 152 L50 194 L8 152 Z" color="#8fd0ff">
          <BlendColor color="#e0533d" mode="multiply" />
        </Path>
        <Path path="M150 110 L192 152 L150 194 L108 152 Z" color="#8fd0ff">
          <BlendColor color="#e0533d" mode="screen" />
        </Path>
      </Stage>,
    );
    await snapshot('paint-blend-color');
  });

  test('reduces colour to luminance with <Luma>', async () => {
    await render(
      <Stage>
        <Fill color="white" />
        <Rect x={10} y={10} width={180} height={80}>
          <LinearGradient
            start={{ x: 10, y: 0 }}
            end={{ x: 190, y: 0 }}
            colors={['#FF3B30', '#34C759', '#0A84FF']}
          />
        </Rect>
        <Rect x={10} y={110} width={180} height={80}>
          <Paint>
            <LinearGradient
              start={{ x: 10, y: 0 }}
              end={{ x: 190, y: 0 }}
              colors={['#FF3B30', '#34C759', '#0A84FF']}
            />
            <Luma />
          </Paint>
        </Rect>
      </Stage>,
    );
    await snapshot('paint-luma');
  });

  test('blurs and drop-shadows past the geometry', async () => {
    await render(
      <Stage>
        <Fill color="#101725" />
        {/* Glow: a blurred disc under a crisp one. */}
        <Circle cx={56} cy={56} r={26} color="#6aa9ff">
          <Blur blur={12} />
        </Circle>
        <Circle cx={56} cy={56} r={26} color="#dceaff" />
        {/* Directional smear: blurX only. */}
        <RoundedRect
          x={116}
          y={34}
          width={64}
          height={44}
          r={10}
          color="#f2c088"
        >
          <Blur blurX={14} blurY={0} />
        </RoundedRect>
        <RoundedRect
          x={30}
          y={120}
          width={100}
          height={52}
          r={14}
          color="#f5f7fa"
        >
          <DropShadow dx={0} dy={7} blur={7} color="rgba(0,0,0,0.7)" />
        </RoundedRect>
        {/* Shadow only: the caster is dropped. */}
        <Circle cx={168} cy={146} r={22} color="#ffffff">
          <Paint color="#ffffff">
            <DropShadow dx={4} dy={4} blur={4} color="#8fd0ff" shadowOnly />
          </Paint>
        </Circle>
      </Stage>,
    );
    await snapshot('paint-blur-dropshadow');
  });

  test('generates fractal noise and turbulence from a fixed seed', async () => {
    await render(
      <Stage>
        <Fill color="white" />
        <Rect x={0} y={0} width={200} height={98}>
          <FractalNoise freqX={0.05} freqY={0.05} octaves={3} seed={7} />
        </Rect>
        <Rect x={0} y={102} width={200} height={98}>
          <Turbulence freqX={0.05} freqY={0.05} octaves={3} seed={7} />
        </Rect>
      </Stage>,
    );
    await snapshot('paint-noise');
  });

  test('multiplies opacity down a paint chain', async () => {
    await render(
      <Stage>
        <Fill color="white" />
        {[1, 0.6, 0.3, 0.1].map((opacity, i) => (
          <Rect
            key={opacity}
            x={10}
            y={10 + i * 48}
            width={180}
            height={40}
            color="#FF3B30"
            opacity={opacity}
          />
        ))}
      </Stage>,
    );
    await snapshot('paint-opacity-ramp');
  });

  test('turns anti-aliasing off', async () => {
    await render(
      <Stage>
        <Fill color="white" />
        <Circle cx={60} cy={100} r={50} color="#1C1C1E" antiAlias={false} />
        <Circle cx={150} cy={100} r={40} color="#1C1C1E" antiAlias={true} />
      </Stage>,
    );
    await snapshot('paint-antialias');
  });
});
