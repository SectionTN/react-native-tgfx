// <ImageSVG>: a whole SVG document, from a file or from markup built in JS.
import React from 'react';
import {
  beforeAll,
  describe,
  expect,
  render,
  test,
} from 'react-native-harness';
import {
  Fill,
  ImageSVG,
  loadImage,
  type TgfxImage,
} from 'react-native-tgfx';
import {
  BACKGROUND,
  Stage,
  drawnSnapshot,
  sameFrame,
  stageBytes,
} from './testSupport';

// The same document as ./assets/logo.svg, written inline. Both must draw alike.
const MARKUP = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 48 48">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="48" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#4F8EF7"/>
      <stop offset="1" stop-color="#AF52DE"/>
    </linearGradient>
  </defs>
  <rect x="1" y="1" width="46" height="46" rx="10" fill="url(#g)"/>
  <path d="M12 30 L20 16 L28 30 Z" fill="#FFD60A"/>
  <circle cx="34" cy="18" r="6" fill="none" stroke="#34C759" stroke-width="3"/>
  <path d="M10 38 H38" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
</svg>`;

let fromFile: TgfxImage;
let fromMarkup: TgfxImage;

beforeAll(async () => {
  // Decoded up front: a load inside the tree lands after the screenshot has
  // already settled on an empty frame, and that blank becomes the baseline.
  fromFile = await loadImage(require('./assets/logo.svg'));
  fromMarkup = await loadImage(MARKUP);
});

describe('tgfx ImageSVG', () => {
  test('markup carries the document its own size, like a file does', () => {
    // 24x24 from the width/height attributes, not 48x48 from the viewBox.
    expect(fromMarkup.width).toBe(24);
    expect(fromMarkup.height).toBe(24);
    expect(fromMarkup.width).toBe(fromFile.width);
  });

  test('draws a whole document — groups, gradients, strokes and all', async () => {
    await drawnSnapshot(
      'imagesvg-markup',
      <ImageSVG image={fromMarkup} x={20} y={20} width={160} height={160} />,
    );
  });

  test('markup and the same document from a file draw alike', async () => {
    await render(
      <Stage>
        <Fill color={BACKGROUND} />
        <ImageSVG image={fromFile} x={20} y={20} width={160} height={160} />
      </Stage>,
    );
    const file = await stageBytes();

    await render(
      <Stage>
        <Fill color={BACKGROUND} />
        <ImageSVG image={fromMarkup} x={20} y={20} width={160} height={160} />
      </Stage>,
    );
    expect(sameFrame(file, await stageBytes())).toBe(true);
  });

  test('a document redraws at size rather than resampling', async () => {
    // Blown up 8x from a 24pt document: an upscaled raster would be soft here.
    await drawnSnapshot(
      'imagesvg-scaled',
      <ImageSVG image={fromMarkup} x={4} y={4} width={192} height={192} />,
    );
  });

  test('markup that is not a document rejects rather than drawing nothing', async () => {
    // The message matters: without the markup route this reaches the base64
    // decoder instead and reports "no decodable bytes", which is not the truth.
    await expect(loadImage('<not-an-svg/>')).rejects.toThrow(/SVG document/);
  });
});
