// The handle table behind <Image> and <ImageShader>.
//
// JS creates images through the TgfxImage hybrid object, which decodes on a
// background thread and registers the result here; the draw program then only
// carries the integer handle. That is what keeps the scene's string table from
// scaling with image bytes, and what makes a re-commit cost one hash-map lookup
// instead of a full-payload hash plus a decode.
//
// Decoded pixels are held in a byte-bounded LRU keyed on the handle. Eviction
// drops only the pixels: the encoded codec stays alive for as long as the JS
// handle does, so an evicted image re-decodes rather than disappearing. That
// re-decode always runs on this class's worker thread — never on the caller's,
// because the caller is the render thread.
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

/// Default budget for decoded pixel buffers held between draws.
///
/// A resident image is resident twice: tgfx's BufferImage holds the decoded
/// ImageBuffer for the Image's whole life (src/core/images/BufferImage.h), and
/// the GPU texture uploaded from it lives under the tgfx Context's own cache
/// limit. Both budgets are set from this one number so a caller raising it
/// raises the real ceiling rather than half of it.
inline constexpr size_t kDefaultImageCacheBytes = 64u << 20;

struct ImageHandle {
  int32_t handle = 0;
  int width = 0;
  int height = 0;
};

class ImageRegistry {
 public:
  /// Process-wide: handles outlive any single view, and a scene compiled on one
  /// view's render thread must resolve handles another view created.
  static ImageRegistry& instance();

  /// Decode `codec` and register the pixels. The decode runs on the calling
  /// thread — call this from a background thread, never from a render thread.
  /// Returns a zero handle when the codec is null or the decode fails.
  ImageHandle add(std::shared_ptr<tgfx::ImageCodec> codec);

  /// Register an image this registry did not decode — a hardware-buffer import,
  /// which is already GPU-resident. Held outside the decoded-pixel budget: the
  /// memory belongs to whoever produced the buffer, and a frame arriving every
  /// 16 ms is not a long-lived asset to evict against.
  ImageHandle addExternal(std::shared_ptr<tgfx::Image> image);

  /// Point an existing external handle at a different image, keeping its id.
  /// The per-frame path: the scene needs no re-commit, and a frame the renderer
  /// has not drawn is superseded rather than queued. Returns false when the
  /// handle is unknown or was not created by addExternal().
  ///
  /// Drops this registry's reference to the previous image before returning, so
  /// the producer gets its buffer slot back on the swap rather than whenever the
  /// scene is next recompiled.
  bool replaceExternal(int32_t handle, std::shared_ptr<tgfx::Image> image);

  /// Drop the handle. A program still referencing it simply stops drawing.
  void remove(int32_t handle);

  /// The image behind `handle`, or nullptr when it is unknown or its pixels
  /// were evicted (in which case a re-decode is scheduled and `epoch()` moves
  /// when it lands, so the node skips frames rather than blocking one).
  /// Safe on a render thread: it never decodes.
  ///
  /// `external` reports whether the entry is a hardware-buffer import, which
  /// the draw path has to re-read every frame instead of caching.
  std::shared_ptr<tgfx::Image> acquire(int32_t handle, bool* external = nullptr);

  /// Bumped whenever the image behind an existing handle changes: a swapped
  /// hardware buffer, a landed re-decode, a disposed handle. A render loop that
  /// folds this into its own dirty check redraws without a re-commit.
  uint64_t epoch() const {
    return epoch_.load(std::memory_order_acquire);
  }

  /// Called whenever epoch() moves. Both render loops are push-driven — Android
  /// posts one draw per staging call, iOS pauses its display link after a few
  /// idle ticks — so a change no commit announced needs somebody to schedule the
  /// draw, or the epoch is read by nothing. This is that somebody.
  ///
  /// Invoked on whichever thread caused the change, with the registry's own lock
  /// released but the listener lock held, so a callback must only schedule work
  /// (post a runnable, unpause a display link) and must not call back in here.
  /// Returns a token for removeWakeListener().
  uint64_t addWakeListener(std::function<void()> wake);
  void removeWakeListener(uint64_t token);

  /// Fire every listener without moving this registry's epoch, for a change
  /// that is not about images at all.
  ///
  /// ponytail: the wake list is "schedule a draw on every bound render loop",
  /// which is a renderer concern that happens to live here because images
  /// needed it first. FontRegistry calls this when a typeface lands. Lift the
  /// list into its own type if a third caller appears.
  void wakeAll();

  void setCacheLimit(size_t bytes);
  size_t cacheLimit() const;
  size_t cachedBytes() const;

  /// Bytes the handle's pixels occupy, for the JS-side external-memory hint.
  size_t byteSize(int32_t handle) const;

  /// Decodes performed. The eviction policy is invisible in the pixels, so the
  /// tests pin it by counting instead.
  size_t decodeCount() const;

  /// Drop every handle and every decoded buffer. Tests only — a live JS handle
  /// would be left pointing at nothing.
  void clear();

  /// Block until every scheduled re-decode has landed. Tests only.
  void waitForDecodes();

 private:
  ImageRegistry() = default;
  ~ImageRegistry();

  struct Entry {
    /// Null for an external (hardware-buffer) entry, which cannot be re-decoded
    /// and is never evicted.
    std::shared_ptr<tgfx::ImageCodec> codec;
    std::shared_ptr<tgfx::Image> decoded;
    int width = 0;
    int height = 0;
    size_t bytes = 0;
    /// Position in `lru_`, valid only while `resident` holds.
    std::list<int32_t>::iterator at{};
    bool resident = false;

    bool external() const {
      return codec == nullptr;
    }
  };

  /// Move the epoch and schedule a draw on every bound render loop. Must be
  /// called with `mutex_` released.
  void bumpEpoch();

  /// All four hold `mutex_`.
  void scheduleDecodeLocked(int32_t handle);
  void touchLocked(int32_t handle, Entry& entry);
  void evictLocked();
  void decodeWorker();

  mutable std::mutex mutex_;
  std::unordered_map<int32_t, Entry> entries_;
  /// Front is the most recently acquired handle.
  std::list<int32_t> lru_;
  size_t cachedBytes_ = 0;
  size_t cacheLimit_ = kDefaultImageCacheBytes;
  size_t decodeCount_ = 0;
  int32_t nextHandle_ = 1;
  std::atomic<uint64_t> epoch_{0};

  /// Its own lock: a wake fires with `mutex_` released, and one render loop
  /// binding a view must not block another's frame.
  mutable std::mutex listenersMutex_;
  std::vector<std::pair<uint64_t, std::function<void()>>> listeners_;
  uint64_t nextListener_ = 1;

  // ponytail: one worker, not a pool — a re-decode only happens after the byte
  // budget dropped an image that is still on screen, which is rare enough that
  // serialising them costs nothing. Widen it if that stops being true.
  std::unordered_set<int32_t> wanted_;
  std::condition_variable wake_;
  std::thread worker_;
  bool stopping_ = false;
};

}  // namespace tgfxrn
