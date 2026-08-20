// A retained GPU surface no view owns. Copies TgfxRenderer's staging idiom —
// setters stage under a mutex from any thread; one shared worker renders — but
// not its code: draw() there is welded to a tgfx::Window, a drawable and a
// display link, none of which exist offscreen.
#pragma once

#include <atomic>
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
class Surface;
}

namespace tgfxrn {

/// toImage()'s tail: the frame as a registered handle, or an error.
using ImageCallback = std::function<void(ImageHandle handle, const std::string& error)>;

class OffscreenSurface : public std::enable_shared_from_this<OffscreenSurface> {
 public:
  OffscreenSurface(int width, int height, float pixelRatio, bool opaque, bool displayP3);
  ~OffscreenSurface();

  OffscreenSurface(const OffscreenSurface&) = delete;
  OffscreenSurface& operator=(const OffscreenSurface&) = delete;

  int width() const {
    return width_;
  }
  int height() const {
    return height_;
  }

  /// The TgfxViewMethods contract: words copied, packedStrings is a delta.
  void setScene(std::span<const double> words, const std::vector<std::string>& packedStrings);
  void setValues(std::vector<double> values);
  void setStringValues(const std::vector<double>& indices,
                       const std::vector<std::string>& values);
  bool setViewport(float zoom, float offsetX, float offsetY);
  /// Canvas points in, index paths out — the view's hitTest, any thread.
  std::vector<double> hitTest(float x, float y, bool precise);

  /// Stage + wake. Never renders on the calling thread.
  void flush();

  /// Render the latest state and encode/write the frame (finishSnapshot tail).
  void requestSave(SnapshotRequest request, SnapshotCallback callback);
  /// Render the latest state and register the frame as an image handle.
  void requestImage(ImageCallback callback);

  /// Frees the surface on the worker and rejects pending readbacks.
  void dispose();

  /// One drain on the worker: apply staged state, render, serve readbacks.
  /// Public so cpp/tests can drive it synchronously without the worker.
  void renderNow();

 private:
  void wake();
  bool takeOutputs(std::vector<std::pair<SnapshotRequest, SnapshotCallback>>& saves,
                   std::vector<ImageCallback>& images);
  static void failOutputs(std::vector<std::pair<SnapshotRequest, SnapshotCallback>>& saves,
                          std::vector<ImageCallback>& images, const std::string& error);

  const int width_;
  const int height_;
  const float pixelRatio_;
  const bool opaque_;
  const bool displayP3_;

  mutable std::mutex mutex_;
  std::vector<double> pendingScene_;
  std::shared_ptr<const StringTable> pendingStrings_;
  std::shared_ptr<const StringTable> strings_ = std::make_shared<StringTable>();
  uint64_t stringsHash_ = hashStrings({});
  uint64_t sceneHash_ = 0;
  bool scenePending_ = false;
  std::vector<double> values_;
  std::vector<std::string> stringValues_;
  std::vector<uint8_t> stringPushed_;
  uint64_t stringGen_ = 0;
  float viewportZoom_ = 1.0f;
  float viewportX_ = 0.0f;
  float viewportY_ = 0.0f;
  std::vector<std::pair<SnapshotRequest, SnapshotCallback>> pendingSaves_;
  std::vector<ImageCallback> pendingImages_;
  bool dead_ = false;

  /// One pending drain per surface; wakes during a drain re-queue.
  std::atomic<bool> queued_{false};

  // Worker-owned render state. drawStringGen_ is compared against stringGen_
  // under mutex_ during staging; everything else never leaves the worker.
  SceneRenderer scene_;
  std::shared_ptr<tgfx::Surface> surface_;
  std::vector<double> drawValues_;
  std::vector<std::string> drawStringValues_;
  std::vector<uint8_t> drawStringPushed_;
  uint64_t drawStringGen_ = 0;
};

}  // namespace tgfxrn
