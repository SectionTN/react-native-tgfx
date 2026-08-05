#include "SvgImage.hpp"

#include <algorithm>
#include <cmath>

#include "FontRegistry.hpp"
#include "tgfx/core/Data.h"
#include "tgfx/core/Image.h"
#include "tgfx/core/Matrix.h"
#include "tgfx/core/PictureRecorder.h"
#include "tgfx/core/Stream.h"
#include "tgfx/svg/SVGDOM.h"
#include "tgfx/svg/TextShaper.h"

namespace tgfxrn {

bool looksLikeSvg(const tgfx::Data& data) {
  const auto* bytes = data.bytes();
  size_t size = data.size();
  // A UTF-8 BOM ahead of the prolog is legal and common out of editors.
  if (size >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF) {
    bytes += 3;
    size -= 3;
  }
  for (size_t i = 0; i < size; ++i) {
    auto c = bytes[i];
    if (c == ' ' || c == '\t' || c == '\r' || c == '\n') {
      continue;
    }
    return c == '<';
  }
  return false;
}

std::shared_ptr<tgfx::Image> svgImage(const std::shared_ptr<tgfx::Data>& data) {
  if (data == nullptr || data->empty()) {
    return nullptr;
  }
  auto stream = tgfx::Stream::MakeFromData(data);
  if (stream == nullptr) {
    return nullptr;
  }
  // Without a shaper, text renders only when the SVG names a font the system already has;
  // this hands it every face <Text> can see, app-registered ones included.
  auto dom =
      tgfx::SVGDOM::Make(*stream, tgfx::TextShaper::Make(FontRegistry::instance().fallbacks()));
  if (dom == nullptr) {
    return nullptr;
  }
  auto size = dom->getContainerSize();
  if (size.isEmpty()) {
    return nullptr;
  }
  tgfx::PictureRecorder recorder;
  dom->render(recorder.beginRecording());
  auto picture = recorder.finishRecordingAsPicture();
  if (picture == nullptr) {
    return nullptr;
  }
  // ponytail: the picture is replayed per draw rather than cached as pixels — right for an icon
  // that scales, wrong for a huge document redrawn every frame. Image::makeRasterized() caps that
  // cost, at the price of freezing the raster size; add it behind a prop if a real scene needs it.
  auto width = std::max(1, static_cast<int>(std::lround(size.width)));
  auto height = std::max(1, static_cast<int>(std::lround(size.height)));
  auto matrix = tgfx::Matrix::MakeScale(static_cast<float>(width) / size.width,
                                        static_cast<float>(height) / size.height);
  return tgfx::Image::MakeFrom(std::move(picture), width, height, &matrix);
}

}  // namespace tgfxrn
