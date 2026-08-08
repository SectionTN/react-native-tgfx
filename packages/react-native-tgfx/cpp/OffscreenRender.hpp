// Draws a compiled program to a GPU surface that no view owns, for renderToImage.
#pragma once

#include <cstddef>
#include <memory>
#include <span>
#include <string>
#include <vector>

namespace tgfx {
class Image;
}

namespace tgfxrn {

/**
 * Renders `words` at `width` x `height` logical points scaled by `pixelRatio`,
 * reporting the pixels allocated in `outBytes`.
 *
 * The result is read back to CPU pixels rather than kept as a texture: the
 * offscreen context is not the one a view draws in, and a texture cannot cross
 * between them. Throws std::runtime_error if there is no usable GPU.
 */
std::shared_ptr<tgfx::Image> renderSceneOffscreen(std::span<const double> words,
                                                  const std::vector<std::string>& strings,
                                                  int width, int height, float pixelRatio,
                                                  bool opaque, size_t& outBytes);

}  // namespace tgfxrn
