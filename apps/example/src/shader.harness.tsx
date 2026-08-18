// Runtime SkSL: uniforms of every arity, child shaders, and helper functions.
import React from 'react';
import { describe, render, test } from 'react-native-harness';
import {
  Fill,
  ImageShader,
  LinearGradient,
  Rect,
  Shader,
  useImage,
} from 'react-native-tgfx';
import { Stage, snapshot } from './testSupport';

const tile = require('./assets/tile.png');

// Analytic, so the same uniforms always produce the same pixels.
const RINGS = `
uniform float2 uSize;
uniform float uBands;
uniform half4 uInk;

half4 main(float2 pos) {
  float2 uv = pos / uSize;
  float d = length(uv - float2(0.5, 0.5));
  float band = fract(d * uBands);
  return half4(uInk.rgb * band, 1.0);
}
`;

const SD_CIRCLE = `
uniform float2 uSize;

// A helper the entry point calls: the compiler has to keep both.
float sdCircle(float2 p, float r) {
  return length(p) - r;
}

half4 main(float2 pos) {
  float2 uv = pos / uSize - float2(0.5, 0.5);
  float d = sdCircle(uv, 0.32);
  float edge = smoothstep(0.0, 0.02, abs(d));
  half3 col = mix(half3(1.0, 0.4, 0.2), half3(0.05, 0.07, 0.15), half(edge));
  return half4(col, 1.0);
}
`;

const PASSTHROUGH = `
uniform shader src;
half4 main(float2 pos) {
  return src.eval(pos);
}
`;

const CHROMATIC = `
uniform shader src;
uniform float uShift;
half4 main(float2 pos) {
  half4 r = src.eval(pos + float2(uShift, 0.0));
  half4 g = src.eval(pos);
  half4 b = src.eval(pos - float2(uShift, 0.0));
  return half4(r.r, g.g, b.b, g.a);
}
`;

const TWO_CHILDREN = `
uniform shader a;
uniform shader b;
uniform float2 uSize;
half4 main(float2 pos) {
  float t = (pos.x / uSize.x);
  return mix(a.eval(pos), b.eval(pos), half(t));
}
`;

describe('tgfx runtime shaders', () => {
  test('fills with a procedural shader', async () => {
    await render(
      <Stage>
        <Fill>
          <Shader
            source={RINGS}
            uniforms={{ uSize: [200, 200], uBands: 6, uInk: [0.3, 0.8, 1, 1] }}
          />
        </Fill>
      </Stage>,
    );
    await snapshot('shader-procedural-rings');
  });

  test('the same shader responds to a changed uniform', async () => {
    await render(
      <Stage>
        <Fill>
          <Shader
            source={RINGS}
            uniforms={{ uSize: [200, 200], uBands: 18, uInk: [1, 0.5, 0.2, 1] }}
          />
        </Fill>
      </Stage>,
    );
    await snapshot('shader-procedural-rings-dense');
  });

  test('compiles a helper function alongside main', async () => {
    await render(
      <Stage>
        <Fill>
          <Shader source={SD_CIRCLE} uniforms={{ uSize: [200, 200] }} />
        </Fill>
      </Stage>,
    );
    await snapshot('shader-helper-function');
  });

  test('evaluates a gradient as a child shader', async () => {
    await render(
      <Stage>
        <Fill color="white" />
        <Rect x={0} y={0} width={200} height={98}>
          <Shader source={PASSTHROUGH}>
            <LinearGradient
              start={{ x: 0, y: 0 }}
              end={{ x: 200, y: 0 }}
              colors={['#FF3B30', '#0A84FF']}
            />
          </Shader>
        </Rect>
        <Rect x={0} y={102} width={200} height={98}>
          <Shader source={CHROMATIC} uniforms={{ uShift: 8 }}>
            <LinearGradient
              start={{ x: 0, y: 102 }}
              end={{ x: 200, y: 102 }}
              colors={['#FF3B30', '#0A84FF']}
            />
          </Shader>
        </Rect>
      </Stage>,
    );
    await snapshot('shader-child-gradient');
  });

  test('mixes two child shaders in one program', async () => {
    await render(
      <Stage>
        <Fill color="white" />
        <Rect x={0} y={0} width={200} height={200}>
          <Shader source={TWO_CHILDREN} uniforms={{ uSize: [200, 200] }}>
            <LinearGradient
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 200 }}
              colors={['#11998e', '#38ef7d']}
            />
            <LinearGradient
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 200 }}
              colors={['#7366FF', '#FF6CAB']}
            />
          </Shader>
        </Rect>
      </Stage>,
    );
    await snapshot('shader-two-children');
  });

  test('evaluates an image as a child shader', async () => {
    function TiledThroughShader() {
      const pattern = useImage(tile);
      return (
        <Stage>
          <Fill color="white" />
          {pattern != null && (
            <Rect x={0} y={0} width={200} height={200}>
              <Shader source={CHROMATIC} uniforms={{ uShift: 4 }}>
                <ImageShader image={pattern} tx="repeat" ty="repeat" />
              </Shader>
            </Rect>
          )}
        </Stage>
      );
    }
    await render(<TiledThroughShader />);
    await snapshot('shader-child-image');
  });
});
