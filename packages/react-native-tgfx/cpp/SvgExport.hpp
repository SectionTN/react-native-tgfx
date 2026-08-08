// Replays a compiled draw program into SVG text, the vector counterpart to snapshot().
#pragma once

#include <span>
#include <string>
#include <vector>

namespace tgfxrn {

/**
 * Renders `words` into an SVG document `width` x `height` points wide.
 *
 * `textAsPaths` writes glyphs as `<path>` outlines instead of `<text>`, which
 * removes the reader's font dependency at the cost of editability. Throws
 * std::runtime_error if there is no usable GPU or the export produced nothing.
 */
std::string renderSceneToSvg(std::span<const double> words,
                             const std::vector<std::string>& strings, float width, float height,
                             bool textAsPaths);

}  // namespace tgfxrn
