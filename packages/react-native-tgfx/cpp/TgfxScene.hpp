// SceneRenderer parses the JSON draw-program produced by the JS reconciler and
// replays it onto a tgfx::Canvas. It is fully platform-agnostic — the same code
// runs on Metal (iOS) and OpenGL (Android). Image and typeface caches live here
// so repeated frames of the same scene avoid re-decoding.
//
// Animated props appear in the JSON as `{ "__s": index }` slot placeholders;
// the live `values` array (updated each frame from a Reanimated worklet via the
// boxed Nitro view) is resolved during rendering, so animation needs no scene
// recompile and no JS-thread work per frame.
#pragma once

#include <memory>
#include <string>
#include <unordered_map>
#include <vector>

#include "tgfx/core/Image.h"
#include "tgfx/core/Typeface.h"

namespace tgfx {
class Canvas;
}

namespace tgfxrn {

class SceneRenderer {
 public:
  /// Replay a serialized scene into the canvas, resolving slot placeholders
  /// against `values`.
  void render(tgfx::Canvas* canvas, const std::string& sceneJson,
              const std::vector<double>& values);

  /// Drop cached GPU/CPU resources (call when the surface is torn down).
  void clearCaches();

 private:
  std::unordered_map<size_t, std::shared_ptr<tgfx::Image>> imageCache_;
  std::unordered_map<std::string, std::shared_ptr<tgfx::Typeface>>
      typefaceCache_;

  std::shared_ptr<tgfx::Image> getImage(const std::string& base64);
  std::shared_ptr<tgfx::Typeface> getTypeface(const std::string& family);
};

}  // namespace tgfxrn
