// TgfxRenderer owns the per-view tgfx GPU loop: it binds to a platform
// tgfx::Window (Metal layer on iOS, EGL/ANativeWindow on Android), (re)creates
// the Surface, and on each frame locks the context, replays the current scene
// via SceneRenderer, then flushes + submits (which presents the window).
//
// Threading model: setScene / setValues / onResize / draw all run on the same
// UI thread (the native prop setters, the Reanimated UI-runtime worklet, and the
// display-link/choreographer callback all live there), and that thread is the
// single owner of the tgfx::Context. `window_`, `surface_`, `values_` and
// `lastScene_` are still guarded by `mutex_`, `dirty_`/`surfaceDirty_` are atomic,
// and SceneRenderer's compiled program is published as an immutable shared_ptr,
// so the design stays correct even if a future change moves rendering to a
// dedicated render thread.
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

  /// Set the device pixel ratio so scene coordinates (logical px / dp) are
  /// scaled to physical pixels before rendering. Call once after the surface
  /// is created. Defaults to 1.0 (no scaling).
  void setPixelRatio(float ratio);

  /// Render one frame. Returns true if it actually rendered, false if it was a
  /// no-op (nothing changed, or no bound window) — the platform loop uses this
  /// to pause itself when idle and resume on the next change.
  bool draw();

  /// Release the surface, window, and cached resources.
  void releaseWindow();

 private:
  std::shared_ptr<tgfx::Window> window_;
  std::shared_ptr<tgfx::Surface> surface_;
  std::string lastScene_;
  std::vector<double> values_;
  SceneRenderer scene_;
  std::mutex mutex_;
  std::atomic<bool> surfaceDirty_{false};
  float pixelRatio_{1.0f};
  // Starts true so the first frame draws once the window is bound; set whenever
  // the scene, values, window, or size change. draw() is a no-op when false.
  std::atomic<bool> dirty_{true};
};

}  // namespace tgfxrn
