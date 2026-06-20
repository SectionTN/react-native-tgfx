// TgfxRenderer owns the per-view tgfx GPU loop: it binds to a platform
// tgfx::Window (Metal layer on iOS, EGL/ANativeWindow on Android), (re)creates
// the Surface, and on each frame locks the context, replays the current scene
// via SceneRenderer, then flushes + submits (which presents the window).
//
// All GPU calls happen on whatever thread drives draw() — the platform's
// display-link / choreographer thread — which is the single owner of the
// tgfx::Context per the library's threading contract.
#pragma once

#include <atomic>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#include "TgfxScene.hpp"

namespace tgfx {
class Window;
class Surface;
}  // namespace tgfx

namespace tgfxrn {

class TgfxRenderer {
 public:
  TgfxRenderer() = default;
  ~TgfxRenderer();

  TgfxRenderer(const TgfxRenderer&) = delete;
  TgfxRenderer& operator=(const TgfxRenderer&) = delete;

  /// Bind to a freshly created platform window. Replaces any previous window.
  void setWindow(std::shared_ptr<tgfx::Window> window);

  /// Update the JSON draw-program; the next draw() reflects it.
  void setScene(const std::string& sceneJson);

  /// Update the live animation value slots (called every frame from a worklet).
  void setValues(const std::vector<double>& values);

  /// Invalidate the cached surface so it is recreated at the new drawable size.
  void onResize();

  /// Render one frame (no-op if there is no bound window/context).
  void draw();

  /// Release the surface, window, and cached resources.
  void releaseWindow();

 private:
  std::shared_ptr<tgfx::Window> window_;
  std::shared_ptr<tgfx::Surface> surface_;
  std::string sceneJson_ = R"({"v":1,"root":{"t":"g","ch":[]}})";
  std::vector<double> values_;
  SceneRenderer scene_;
  std::mutex mutex_;
  std::atomic<bool> surfaceDirty_{false};
};

}  // namespace tgfxrn
