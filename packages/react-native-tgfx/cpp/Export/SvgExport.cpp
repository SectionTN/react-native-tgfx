#include "SvgExport.hpp"

#include <stdexcept>

#include "OffscreenRender.hpp"
#include "TgfxScene.hpp"
#include "tgfx/core/Canvas.h"
#include "tgfx/core/Rect.h"
#include "tgfx/core/WriteStream.h"
#include "tgfx/svg/SVGExporter.h"

namespace tgfxrn {

std::string renderSceneToSvg(std::span<const double> words,
                             const std::vector<std::string>& strings, float width, float height,
                             bool textAsPaths) {
  if (!(width > 0) || !(height > 0)) {
    throw std::runtime_error("tgfx: renderToSvg needs a width and height above zero");
  }
  auto stream = tgfx::MemoryWriteStream::Make();
  if (stream == nullptr) {
    throw std::runtime_error("tgfx: renderToSvg could not allocate an output stream");
  }

  OffscreenContext locked;
  uint32_t flags = textAsPaths ? tgfx::SVGExportFlags::ConvertTextToPaths : 0;
  auto exporter = tgfx::SVGExporter::Make(stream, locked.get(),
                                          tgfx::Rect::MakeWH(width, height), flags);
  if (exporter == nullptr) {
    throw std::runtime_error("tgfx: renderToSvg could not start the document");
  }
  auto* canvas = exporter->getCanvas();
  if (canvas == nullptr) {
    throw std::runtime_error("tgfx: renderToSvg could not open a canvas");
  }
  SceneRenderer renderer;
  renderer.setScene(words, strings);
  if (renderer.rootCount() == 0) {
    // A rejected program would otherwise export as a well-formed empty document.
    throw std::runtime_error("tgfx: renderToSvg could not read the draw program");
  }
  // No values: an export is a still, so every animated prop resolves to its literal.
  renderer.render(canvas, {});
  // Closed before the bytes are read: the closing tag is written here.
  exporter->close();

  // readString, not readData: the extra Data hop copies the whole document again.
  auto svg = stream->readString();
  if (svg.empty()) {
    throw std::runtime_error("tgfx: renderToSvg produced no document");
  }
  return svg;
}

}  // namespace tgfxrn
