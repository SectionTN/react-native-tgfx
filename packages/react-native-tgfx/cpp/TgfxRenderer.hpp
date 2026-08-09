// The per-view tgfx GPU loop. The render thread owns everything but `values_`, written under `mutex_`.
#pragma once

#include <atomic>
#include <functional>
#include <cstdint>
#include <memory>
#include <mutex>
#include <span>
#include <string>
#include <utility>
#include <vector>

#include "ImageRegistry.hpp"
#include "SceneHash.hpp"
#include "SceneStrings.hpp"
#include "Snapshot.hpp"
#include "TgfxScene.hpp"

namespace tgfx {
class Context;
class Window;
class Surface;
class SurfaceReadback;
}  // namespace tgfx

namespace tgfxrn {

class TgfxRenderer {
 public:
  TgfxRenderer() = default;
  ~TgfxRenderer();

  TgfxRenderer(const TgfxRenderer&) = delete;
  TgfxRenderer& operator=(const TgfxRenderer&) = delete;

  void setWindow(std::shared_ptr<tgfx::Window> window);

  /// Stage a draw program. `words` is copied; `packedStrings` is a delta, see SceneStrings.hpp.
  void setScene(std::span<const double> words,
                const std::vector<std::string>& packedStrings);

  void clearScene();

  void setOpaque(bool opaque);

  void setValues(const std::vector<double>& values);

  /// Sparse writes into the string-slot array (live text and path data).
  void setStringValues(const std::vector<double>& indices,
                       const std::vector<std::string>& values);

  /// Index paths under a point, flattened. Safe from any thread; see TgfxScene.hpp.
  std::vector<double> hitTest(float x, float y, bool precise);

  void onResize();

  void setPixelRatio(float ratio);

  /// Read when the window is built; a later change cannot move an existing window's space.
  void setColorSpace(bool displayP3);

  bool wantsDisplayP3() const {
    return displayP3_.load(std::memory_order_relaxed);
  }

  /// How this view's push-driven loop schedules a draw. Any thread; must only schedule.
  void setWakeCallback(std::function<void()> wake);

  bool draw();

  void requestSnapshot(const SnapshotRequest& request, SnapshotCallback callback);

  /// Hold readbacks until a surface created after this call exists, for iOS's framebufferOnly flip.
  void deferSnapshotsToNextSurface();

  bool snapshotPending() const {
    return snapshotPending_.load(std::memory_order_acquire);
  }

  void releaseWindow();

 private:
  struct InFlightSnapshot {
    std::shared_ptr<tgfx::SurfaceReadback> readback;
    std::shared_ptr<tgfx::Surface> scratch;
    SnapshotRequest request;
    SnapshotCallback callback;
    bool flipY = false;
  };

  void startSnapshots(tgfx::Context* context);
  void collectSnapshots(tgfx::Context* context);
  std::vector<InFlightSnapshot> takeSnapshots();
  void releaseGpuObjects(const std::shared_ptr<tgfx::Window>& window,
                         std::vector<InFlightSnapshot>& entries);
  static void dropGpuHandles(std::vector<InFlightSnapshot>& entries);
  static void failSnapshots(std::vector<InFlightSnapshot> entries,
                            const std::string& error);
  static void deliverError(SnapshotCallback callback, std::string error);
  void failSnapshots(const std::shared_ptr<tgfx::Window>& window,
                     const std::string& error);
  void updateSnapshotPending();

  std::shared_ptr<tgfx::Window> window_;
  std::shared_ptr<tgfx::Surface> surface_;
  std::vector<double> pendingScene_;
  // Shared, never copied: a geometry-only commit must not re-copy the image payloads.
  std::shared_ptr<const StringTable> pendingStrings_;
  std::shared_ptr<const StringTable> strings_ = std::make_shared<StringTable>();
  uint64_t stringsHash_ = hashStrings({});
  bool scenePending_ = false;
  bool cachesDirty_ = false;
  uint64_t sceneHash_ = 0;
  /// The FontRegistry epoch this command list was compiled against; a later face forces a recompile.
  uint64_t compiledFontEpoch_ = 0;
  std::vector<double> values_;
  std::vector<double> drawValues_;
  std::vector<std::string> stringValues_;
  std::vector<std::string> drawStringValues_;
  /// Which slots a push has written; unpushed slots keep their compiled literal.
  std::vector<uint8_t> stringPushed_;
  std::vector<uint8_t> drawStringPushed_;
  uint64_t stringGen_ = 0;
  uint64_t drawStringGen_ = 0;
  std::vector<double> drawScene_;
  std::shared_ptr<const StringTable> drawStrings_;
  SceneRenderer scene_;
  size_t appliedCacheLimit_ = 0;
  bool cacheLimitApplied_ = false;
  mutable std::mutex mutex_;
  std::atomic<bool> surfaceDirty_{false};
  std::atomic<float> pixelRatio_{1.0f};
  std::atomic<bool> opaque_{false};
  std::atomic<uint64_t> version_{1};
  uint64_t drawnVersion_{0};
  uint64_t wakeToken_ = 0;
  std::vector<std::pair<SnapshotRequest, SnapshotCallback>> pendingSnapshots_;
  std::vector<InFlightSnapshot> inFlightSnapshots_;
  std::atomic<bool> displayP3_{false};
  std::atomic<bool> snapshotPending_{false};
  // A counter, not a flag: a surface created before the bump must not clear it.
  std::atomic<uint64_t> snapshotBarrier_{0};
  uint64_t surfaceBarrier_{0};
};

}  // namespace tgfxrn
