// The root transform a viewport becomes. Its own header so a test can assert the
// composition order: get preTranslate and preScale the wrong way round and the
// pan starts scaling with the zoom, which no pixel test off a device would catch.
#pragma once

#include "tgfx/core/Matrix.h"

namespace tgfxrn {

/**
 * `scale(pixelRatio) * translate(offset) * scale(zoom)` — pan in canvas points,
 * then zoom about the scene origin, the order a scroll view uses. A scene point
 * `p` lands at `pixelRatio * (offset + zoom * p)`.
 *
 * Pass `pixelRatio = 1` for anything working in canvas points rather than
 * surface pixels, which is what a hit test gets.
 */
inline tgfx::Matrix rootMatrix(float pixelRatio, float zoom, float offsetX, float offsetY) {
  auto matrix = tgfx::Matrix::MakeScale(pixelRatio, pixelRatio);
  matrix.preTranslate(offsetX, offsetY);
  matrix.preScale(zoom, zoom);
  return matrix;
}

}  // namespace tgfxrn
