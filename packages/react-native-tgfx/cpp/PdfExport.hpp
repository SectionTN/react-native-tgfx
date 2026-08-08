// Replays compiled draw programs into PDF pages, which stay vectors rather than pixels.
#pragma once

#include <span>
#include <string>
#include <vector>

namespace tgfxrn {

/// One page: its size in points and the program that draws it.
struct PdfPage {
  std::vector<double> words;
  std::vector<std::string> strings;
  float width = 0;
  float height = 0;
};

struct PdfMetadata {
  std::string title;
  std::string author;
  std::string subject;
  std::string creator;
};

/**
 * Writes `pages` to `path` as a PDF. Needs a GPU context only for the images a
 * page draws; the geometry and text stay vectors. Throws std::runtime_error if
 * the file cannot be written or there is no usable GPU.
 */
void writePdf(const std::string& path, const std::vector<PdfPage>& pages,
              const PdfMetadata& metadata);

}  // namespace tgfxrn
