#include "PdfExport.hpp"

#include <cstdio>
#include <stdexcept>

#include "OffscreenRender.hpp"
#include "TgfxScene.hpp"
#include "tgfx/core/Canvas.h"
#include "tgfx/core/WriteStream.h"
#include "tgfx/pdf/PDFDocument.h"

namespace tgfxrn {

void writePdf(const std::string& path, const std::vector<PdfPage>& pages,
              const PdfMetadata& metadata) {
  if (pages.empty()) {
    throw std::runtime_error("tgfx: renderToPdf needs at least one page");
  }
  // Everything that can fail cheaply happens before a byte is written: opening the
  // stream truncates, and a half-written document must never replace a good file.
  for (const auto& page : pages) {
    if (!(page.width > 0) || !(page.height > 0)) {
      throw std::runtime_error("tgfx: renderToPdf needs a page size above zero");
    }
  }

  OffscreenContext locked;
  // Written aside and renamed, so a throw leaves whatever was at `path` untouched.
  std::string scratch = path + ".tgfx-partial";
  auto stream = tgfx::WriteStream::MakeFromFile(scratch);
  if (stream == nullptr) {
    throw std::runtime_error("tgfx: renderToPdf could not open " + path + " for writing");
  }
  struct Discard {
    const std::string& scratch;
    bool armed = true;
    ~Discard() {
      if (armed) {
        std::remove(scratch.c_str());
      }
    }
  } discard{scratch};
  tgfx::PDFMetadata info;
  info.title = metadata.title;
  info.author = metadata.author;
  info.subject = metadata.subject;
  info.creator = metadata.creator;
  auto document = tgfx::PDFDocument::Make(std::move(stream), locked.get(), info);
  if (document == nullptr) {
    throw std::runtime_error("tgfx: renderToPdf could not start the document");
  }
  // The destructor closes rather than aborts, so an escaping throw would otherwise
  // leave a complete, valid document holding only the pages drawn so far.
  struct Abort {
    tgfx::PDFDocument* document;
    bool armed = true;
    ~Abort() {
      if (armed) {
        document->abort();
      }
    }
  } guard{document.get()};

  for (size_t i = 0; i < pages.size(); i++) {
    const auto& page = pages[i];
    auto* canvas = document->beginPage(page.width, page.height);
    if (canvas == nullptr) {
      throw std::runtime_error("tgfx: renderToPdf could not begin page " + std::to_string(i));
    }
    SceneRenderer renderer;
    renderer.setScene(page.words, page.strings);
    // No values: a page is a still, so every animated prop resolves to its literal.
    renderer.render(canvas, {});
    document->endPage();
  }
  guard.armed = false;
  document->close();
  if (std::rename(scratch.c_str(), path.c_str()) != 0) {
    throw std::runtime_error("tgfx: renderToPdf could not move the document to " + path);
  }
  discard.armed = false;
}

}  // namespace tgfxrn
