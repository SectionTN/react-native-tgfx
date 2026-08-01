// TgfxRenderer owns the per-view tgfx GPU loop: it binds to a platform
// tgfx::Window (Metal layer on iOS, EGL/ANativeWindow on Android), (re)creates
// the Surface, and on each frame locks the context, replays the current scene
// via SceneRenderer, then flushes + submits (which presents the window).
//
// The render thread owns every member except `values_`, which the animation
// driver writes from the UI thread under `mutex_`.
#pragma once

#include <atomic>
#include <cstdint>
#include <memory>
#include <mutex>
#include <span>
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

  /// Stage a new binary draw-program. `words` belongs to the caller and is only
  /// valid for this call, so it is copied here; the (cheap) compile into the
  /// command list then happens on the render thread inside draw().
  void setScene(std::span<const double> words,
                const std::vector<std::string>& strings);

  /// Drop the current program (a recycled view must not flash the old scene).
  void clearScene();

  /// Clear to opaque black instead of transparent, for an opaque surface.
  void setOpaque(bool opaque);

  /// Update the live animation value slots (called every frame from a worklet).
  void setValues(const std::vector<double>& values);

  /// Invalidate the cached surface so it is recreated at the new drawable size.
  void onResize();

  /// Set the device pixel ratio so scene coordinates (logical px / dp) are
  /// scaled to physical pixels before rendering. Call once after the surface
  /// is created. Defaults to 1.0 (no scaling).
  void setPixelRatio(float ratio);

  /// Render one frame. Returns false when nothing changed or no window is bound.
  bool draw();

  /// Draw a camera frame, blurring the interior of each contour. `contours` is a
  /// flat polygon list: point count, then that many x,y pairs, per shape.
  /// The image and the contours share one transform so they cannot drift apart.
  void drawCameraFrame(void* hardwareBuffer, float frameWidth, float frameHeight,
                       const std::vector<float>& contours, float blurRadius);

  /// Release the surface, window, and cached resources.
  void releaseWindow();

 private:
  std::shared_ptr<tgfx::Window> window_;
  std::shared_ptr<tgfx::Surface> surface_;
  std::vector<double> pendingScene_;
  std::vector<std::string> pendingStrings_;
  bool scenePending_ = false;
  uint64_t sceneHash_ = 0;
  std::vector<double> values_;
  // Render-thread buffers, refilled in place so no frame allocates under the lock.
  std::vector<double> drawValues_;
  std::vector<double> drawScene_;
  std::vector<std::string> drawStrings_;
  SceneRenderer scene_;
  std::mutex mutex_;
  std::atomic<bool> surfaceDirty_{false};
  float pixelRatio_{1.0f};
  std::atomic<bool> opaque_{false};
  std::atomic<uint64_t> version_{1};
  uint64_t drawnVersion_{0};
};

}  // namespace tgfxrn
