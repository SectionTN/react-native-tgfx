// <BackdropBlur> and <Glass>: panels that sample what is already on the surface.
import React from 'react';
import { describe, expect, render, test } from 'react-native-harness';
import {
  BackdropBlur,
  Fill,
  Glass,
  Rect,
  useNode,
  type NodeHandle,
} from 'react-native-tgfx';
import { Stage, sameFrame, sleep, snapshot, stageBytes } from './testSupport';

/** A hard edge for a panel to smear and refract across. */
function Beneath() {
  return (
    <>
      <Fill color="#0A84FF" />
      <Rect x={0} y={0} width={100} height={200} color="#FF3B30" />
    </>
  );
}

const PANEL = { x: 30, y: 50, width: 140, height: 100, r: 24 } as const;

describe('tgfx backdrops', () => {
  test('a blur panel frosts what is beneath it', async () => {
    await render(
      <Stage>
        <Beneath />
        <BackdropBlur {...PANEL} blur={16} />
      </Stage>,
    );
    await snapshot('backdrop-blur');
  });

  test('glass refracts rather than blurring', async () => {
    await render(
      <Stage>
        <Beneath />
        <BackdropBlur {...PANEL} blur={16} />
      </Stage>,
    );
    const blurred = await stageBytes();

    await render(
      <Stage>
        <Beneath />
        <Glass {...PANEL} refraction={60} depth={30} frost={20} />
      </Stage>,
    );
    const glassy = await stageBytes();
    expect(sameFrame(blurred, glassy)).toBe(false);
    await snapshot('backdrop-glass');
  });

  // The three words scene 28 added. Hardcoded, a <Glass> could only ever be lit
  // from one direction at one brightness.
  test('the light angle turns the highlight', async () => {
    await render(
      <Stage>
        <Beneath />
        <Glass {...PANEL} refraction={60} depth={30} lightAngle={45} />
      </Stage>,
    );
    const fromAbove = await stageBytes();

    await render(
      <Stage>
        <Beneath />
        <Glass {...PANEL} refraction={60} depth={30} lightAngle={-135} />
      </Stage>,
    );
    expect(sameFrame(fromAbove, await stageBytes())).toBe(false);
  });

  test('zero light intensity keeps the refraction and drops the highlight', async () => {
    await render(
      <Stage>
        <Beneath />
        <Glass {...PANEL} refraction={60} depth={30} lightIntensity={50} />
      </Stage>,
    );
    const lit = await stageBytes();

    await render(
      <Stage>
        <Beneath />
        <Glass {...PANEL} refraction={60} depth={30} lightIntensity={0} />
      </Stage>,
    );
    const unlit = await stageBytes();
    expect(sameFrame(lit, unlit)).toBe(false);

    // Still a glass panel, not a hole: it must differ from no panel at all.
    await render(
      <Stage>
        <Beneath />
      </Stage>,
    );
    expect(sameFrame(unlit, await stageBytes())).toBe(false);
  });

  test('splay aims the refraction', async () => {
    await render(
      <Stage>
        <Beneath />
        <Glass {...PANEL} refraction={60} depth={30} splay={0} />
      </Stage>,
    );
    const edgeward = await stageBytes();

    await render(
      <Stage>
        <Beneath />
        <Glass {...PANEL} refraction={60} depth={30} splay={100} />
      </Stage>,
    );
    expect(sameFrame(edgeward, await stageBytes())).toBe(false);
  });

  // Every material word is a slot, so a handle moves the light with no commit.
  test('a handle turns the light without re-encoding the scene', async () => {
    let panel: NodeHandle | null = null;

    function Scene() {
      const glass = useNode();
      panel = glass;
      return (
        <Stage>
          <Beneath />
          <Glass ref={glass} {...PANEL} refraction={60} depth={30} />
        </Stage>
      );
    }

    await render(<Scene />);
    const lit = await stageBytes();

    // No prop changed and nothing re-rendered: this is a slot write.
    panel!.set({ lightAngle: -135 });
    await sleep(400);
    expect(sameFrame(lit, await stageBytes(0))).toBe(false);
  });
});
