// The root viewport: a zoom/pan the renderer owns, above the whole draw program.
import React, { useRef } from 'react';
import { describe, expect, render, test } from 'react-native-harness';
import { Circle, Fill, Rect, type CanvasHandle } from 'react-native-tgfx';
import { Stage, sameFrame, sleep, snapshot, stageBytes } from './testSupport';

/** Two shapes, off-centre on both axes, so a zoom and a pan look different. */
function Shapes() {
  return (
    <>
      <Fill color="white" />
      <Rect x={20} y={20} width={60} height={40} color="#0A84FF" />
      <Circle cx={120} cy={130} r={30} color="#FF9500" />
    </>
  );
}

describe('tgfx viewport', () => {
  test('draws unchanged at the identity', async () => {
    await render(
      <Stage viewport={{ zoom: 1, x: 0, y: 0 }}>
        <Shapes />
      </Stage>,
    );
    const identity = await stageBytes();

    await render(
      <Stage>
        <Shapes />
      </Stage>,
    );
    expect(sameFrame(identity, await stageBytes())).toBe(true);
  });

  test('zooms about the scene origin', async () => {
    await render(
      <Stage viewport={{ zoom: 2 }}>
        <Shapes />
      </Stage>,
    );
    await snapshot('viewport-zoom');
  });

  test('pans in canvas points, after the zoom', async () => {
    await render(
      <Stage viewport={{ zoom: 2, x: -100, y: -80 }}>
        <Shapes />
      </Stage>,
    );
    await snapshot('viewport-zoom-pan');
  });

  test('a pan alone shifts the scene by the offset', async () => {
    await render(
      <Stage viewport={{ x: 40, y: 25 }}>
        <Shapes />
      </Stage>,
    );
    await snapshot('viewport-pan');
  });

  test('a non-positive zoom is ignored rather than collapsing the scene', async () => {
    await render(
      <Stage viewport={{ zoom: 0 }}>
        <Shapes />
      </Stage>,
    );
    const collapsed = await stageBytes();

    await render(
      <Stage>
        <Shapes />
      </Stage>,
    );
    expect(sameFrame(collapsed, await stageBytes())).toBe(true);
  });

  test('hitTest inverts the viewport with the rest of the transform', async () => {
    let canvas: React.RefObject<CanvasHandle | null> | null = null;

    function Tapped() {
      const ref = useRef<CanvasHandle>(null);
      canvas = ref;
      return (
        <Stage canvasRef={ref} viewport={{ zoom: 2 }}>
          <Fill color="white" />
          <Rect x={10} y={10} width={30} height={30} color="#0A84FF" />
        </Stage>
      );
    }

    await render(<Tapped />);
    await sleep(300);

    // The rect covers scene 10..40, so screen 20..80 at zoom 2. The <Fill>
    // answers everywhere, so the rect shows up as one extra hit.
    const hits = (x: number, y: number) => canvas!.current!.hitTest(x, y).length;
    expect(hits(60, 60)).toBeGreaterThan(hits(15, 15));
    expect(hits(60, 60)).toBeGreaterThan(hits(90, 90));
  });

  test('setViewport moves the frame without a prop', async () => {
    let canvas: React.RefObject<CanvasHandle | null> | null = null;

    function Handled() {
      const ref = useRef<CanvasHandle>(null);
      canvas = ref;
      return (
        <Stage canvasRef={ref}>
          <Shapes />
        </Stage>
      );
    }

    await render(<Handled />);
    const before = await stageBytes();

    canvas!.current!.setViewport({ zoom: 1.8 });
    await sleep(400);
    expect(sameFrame(before, await stageBytes(0))).toBe(false);
  });

  test('snapshot reads back the zoomed frame', async () => {
    let canvas: React.RefObject<CanvasHandle | null> | null = null;

    function Read() {
      const ref = useRef<CanvasHandle>(null);
      canvas = ref;
      return (
        <Stage canvasRef={ref} viewport={{ zoom: 3 }}>
          <Fill color="white" />
          <Rect x={0} y={0} width={20} height={20} color="#0A84FF" />
        </Stage>
      );
    }

    await render(<Read />);
    await sleep(400);

    // 55,55 is inside the rect at zoom 3 (0..60) and outside it at zoom 1.
    const shot = await canvas!.current!.snapshot({
      format: 'raw',
      rect: { x: 55, y: 55, width: 1, height: 1 },
    });
    const px = new Uint8Array(shot.data);
    expect(px[2]!).toBeGreaterThan(px[0]!);
  });
});
