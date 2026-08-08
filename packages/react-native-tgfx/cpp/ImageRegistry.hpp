// The handle table behind <Image> and <ImageShader>; decoded pixels sit in a byte-bounded LRU.
#pragma once

#include <atomic>
#include <condition_variable>
#include <functional>
#include <cstddef>
#include <cstdint>
#include <list>
#include <memory>
#include <mutex>
#include <thread>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

namespace tgfx {
class Data;
class Image;
class ImageCodec;
}  // namespace tgfx

namespace tgfxrn {

/// Default budget for decoded pixels. Applied to the GPU cache too: an image is resident twice.
inline constexpr size_t kDefaultImageCacheBytes = 64u << 20;

struct ImageHandle {
  int32_t handle = 0;
  int width = 0;
  int height = 0;
};

class ImageRegistry {
 public:
  static ImageRegistry& instance();

  /// Decode and register. Decodes on the calling thread — never call from a render thread.
  ImageHandle add(std::shared_ptr<tgfx::ImageCodec> codec);

  /// Register an image this registry did not decode. Outside the byte budget: not ours to evict.
  /**
   * Registers an image the caller already holds pixels for. `ownedBytes` is what
   * this process allocated to make it, reported to the JS GC but never evicted —
   * pass 0 for an image whose pixels are someone else's (an SVG picture, a
   * hardware buffer).
   */
  ImageHandle addExternal(std::shared_ptr<tgfx::Image> image, size_t ownedBytes = 0);

  bool replaceExternal(int32_t handle, std::shared_ptr<tgfx::Image> image);

  /**
   * Register a source that produces its current image on demand, for a video
   * stream. `produce` runs on the render thread inside acquire(), because a
   * platform stream's buffer is only good for one texture generation: produced
   * ahead of the draw, it would expire before the draw ever used it, and the
   * canvas would go black the moment playback stopped feeding it new ones.
   */
  ImageHandle addStream(std::function<std::shared_ptr<tgfx::Image>()> produce, int width,
                        int height);

  /// Move the epoch, so canvases redraw. For a stream that has a new frame ready.
  void invalidate();

  void remove(int32_t handle);

  /// The image behind `handle`, or nullptr when unknown or evicted. Never decodes.
  std::shared_ptr<tgfx::Image> acquire(int32_t handle, bool* external = nullptr);

  uint64_t epoch() const {
    return epoch_.load(std::memory_order_acquire);
  }

  /// Called whenever epoch() moves, under the listener lock, so it may only schedule work.
  uint64_t addWakeListener(std::function<void()> wake);
  void removeWakeListener(uint64_t token);

  void wakeAll();

  void setCacheLimit(size_t bytes);
  size_t cacheLimit() const;
  size_t cachedBytes() const;

  size_t byteSize(int32_t handle) const;

  size_t decodeCount() const;

  void clear();

  void waitForDecodes();

 private:
  ImageRegistry() = default;
  ~ImageRegistry();

  struct Entry {
    /// Null for an external entry, which cannot be re-decoded and is never evicted.
    std::shared_ptr<tgfx::ImageCodec> codec;
    std::shared_ptr<tgfx::Image> decoded;
    int width = 0;
    int height = 0;
    size_t bytes = 0;
    std::list<int32_t>::iterator at{};
    bool resident = false;
    /// Set for a stream entry; `decoded` stays null and the image comes from here.
    std::function<std::shared_ptr<tgfx::Image>()> produce;

    bool external() const {
      return codec == nullptr;
    }
  };

  void bumpEpoch();

  void scheduleDecodeLocked(int32_t handle);
  void touchLocked(int32_t handle, Entry& entry);
  void evictLocked();
  void decodeWorker();

  mutable std::mutex mutex_;
  std::unordered_map<int32_t, Entry> entries_;
  std::list<int32_t> lru_;
  size_t cachedBytes_ = 0;
  size_t cacheLimit_ = kDefaultImageCacheBytes;
  size_t decodeCount_ = 0;
  int32_t nextHandle_ = 1;
  std::atomic<uint64_t> epoch_{0};

  mutable std::mutex listenersMutex_;
  std::vector<std::pair<uint64_t, std::function<void()>>> listeners_;
  uint64_t nextListener_ = 1;

  // ponytail: one worker, not a pool — a re-decode only follows an eviction of a live image.
  std::unordered_set<int32_t> wanted_;
  std::condition_variable wake_;
  std::thread worker_;
  bool stopping_ = false;
};

}  // namespace tgfxrn
