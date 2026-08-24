// SVG documents as image handles: parsed once into a Picture that replays at whatever size it is drawn.
#pragma once

#include <memory>

namespace tgfx {
class Data;
class Image;
}  // namespace tgfx

namespace tgfxrn {

/// True when the bytes open like XML. No encoded raster format starts with '<'.
bool looksLikeSvg(const tgfx::Data& data);

/// Parse and record, sized as the document's own width/height/viewBox asks.
///
/// That size is nominal, not a resolution cap: the image keeps the picture and replays it at
/// draw resolution, so a 24px icon drawn at 240px is redrawn rather than resampled — measured
/// in cpp/tests/SceneTest.cpp, which asserts the edge stays one pixel wide at 8x.
/// Returns nullptr when the bytes are not a renderable SVG.
std::shared_ptr<tgfx::Image> svgImage(const std::shared_ptr<tgfx::Data>& data);

}  // namespace tgfxrn
