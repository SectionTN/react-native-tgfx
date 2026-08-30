// fromPixels/setPixels: wrapping already-decoded pixels, and re-pointing one handle at new ones.
import React from 'react';
import {
  afterAll,
  describe,
  expect,
  render,
  test,
} from 'react-native-harness';
import {
  TgfxImage as TgfxImageView,
  imageFromPixels,
  type TgfxImage,
} from 'react-native-tgfx';
import {
  Stage,
  drawnSnapshot,
  sameFrame,
  stageBytes,
} from './testSupport';

const SIZE = 8;

/// Premultiplied RGBA, which is what the API declares. Opaque colours are their
/// own premultiplied form, so these are the plain components.
function solid(r: number, g: number, b: number, size = SIZE): ArrayBuffer {
  const bytes = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    bytes[i * 4] = r;
    bytes[i * 4 + 1] = g;
    bytes[i * 4 + 2] = b;
    bytes[i * 4 + 3] = 255;
  }
  return bytes.buffer;
}

const RED = solid(220, 40, 40);
const BLUE = solid(40, 80, 220);

const handles: TgfxImage[] = [];

function keep(image: TgfxImage): TgfxImage {
  handles.push(image);
  return image;
}

describe('fromPixels', () => {
  afterAll(() => {
    for (const image of handles) {
      image.dispose();
    }
    handles.length = 0;
  });

  test('wraps pixels at the size it is given', () => {
    const image = keep(imageFromPixels(RED, SIZE, SIZE));
    expect(image.width).toBe(SIZE);
    expect(image.height).toBe(SIZE);
    expect(typeof image.handle).toBe('number');
  });

  test('derives the stride when rowBytes is omitted', () => {
    const implicit = keep(imageFromPixels(RED, SIZE, SIZE));
    const explicit = keep(imageFromPixels(RED, SIZE, SIZE, SIZE * 4));
    expect(implicit.width).toBe(explicit.width);
    expect(implicit.height).toBe(explicit.height);
  });

  test('rejects a buffer too small for the size', () => {
    expect(() => imageFromPixels(solid(0, 0, 0, 2), SIZE, SIZE)).toThrow();
  });

  test('rejects an empty buffer', () => {
    expect(() => imageFromPixels(new ArrayBuffer(0), SIZE, SIZE)).toThrow();
  });

  test('rejects a non-finite size', () => {
    expect(() => imageFromPixels(RED, Number.NaN, SIZE)).toThrow();
  });

  test('rejects a negative rowBytes', () => {
    expect(() => imageFromPixels(RED, SIZE, SIZE, -4)).toThrow();
  });

  test('rejects a rowBytes large enough to overflow the byte size', () => {
    expect(() => imageFromPixels(RED, SIZE, SIZE, 2 ** 61)).toThrow();
  });

  test('draws the pixels it was given', async () => {
    const image = keep(imageFromPixels(RED, SIZE, SIZE));
    await drawnSnapshot(
      'pixels-from-pixels',
      <TgfxImageView x={20} y={20} width={160} height={160} image={image} />,
    );
  });
});

describe('setPixels', () => {
  afterAll(() => {
    for (const image of handles) {
      image.dispose();
    }
    handles.length = 0;
  });

  test('keeps the handle id', () => {
    const image = keep(imageFromPixels(RED, SIZE, SIZE));
    const before = image.handle;
    image.setPixels(BLUE, SIZE, SIZE);
    expect(image.handle).toBe(before);
  });

  test('takes the new size', () => {
    const image = keep(imageFromPixels(RED, SIZE, SIZE));
    image.setPixels(solid(0, 0, 0, 4), 4, 4);
    expect(image.width).toBe(4);
    expect(image.height).toBe(4);
  });

  test('changes what is drawn', async () => {
    const image = keep(imageFromPixels(RED, SIZE, SIZE));
    const scene = (
      <TgfxImageView x={20} y={20} width={160} height={160} image={image} />
    );

    await render(<Stage>{scene}</Stage>);
    const red = await stageBytes();

    image.setPixels(BLUE, SIZE, SIZE);
    await render(
      <Stage>
        <>{scene}</>
      </Stage>,
    );
    const blue = await stageBytes();

    expect(sameFrame(red, blue)).toBe(false);
  });
});
