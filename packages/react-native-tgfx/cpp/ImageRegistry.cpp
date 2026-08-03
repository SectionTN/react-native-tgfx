#include "ImageRegistry.hpp"

#include "Log.hpp"
#include "tgfx/core/Image.h"
#include "tgfx/core/ImageBuffer.h"
#include "tgfx/core/ImageCodec.h"

namespace tgfxrn {

namespace {

/// Decode `codec` into a fully-decoded Image. Synchronous by construction:
/// makeBuffer() does the work here rather than scheduling it, which is the
/// whole point — a render thread must never be the one to pay for it.
std::shared_ptr<tgfx::Image> decode(const tgfx::ImageCodec& codec) {
  auto buffer = codec.makeBuffer();
  if (buffer == nullptr) {
    return nullptr;
  }
  auto image = tgfx::Image::MakeFrom(std::move(buffer));
  if (image == nullptr) {
    return nullptr;
  }
  // MakeFrom(ImageBuffer) knows nothing about EXIF, so apply it here — the
  // Image::MakeFromEncoded path this replaces did it for us.
  return image->makeOriented(codec.orientation());
}

/// CPU-side cost only. The same pixels are resident a second time as a GPU
/// texture, under the tgfx Context's cache limit — see kDefaultImageCacheBytes.
size_t byteSizeOf(const tgfx::Image& image) {
  auto pixels = static_cast<size_t>(image.width()) * static_cast<size_t>(image.height());
  return image.isAlphaOnly() ? pixels : pixels * 4;
}

}  // namespace

ImageRegistry& ImageRegistry::instance() {
  static ImageRegistry registry;
  return registry;
}

ImageRegistry::~ImageRegistry() {
  {
    std::lock_guard<std::mutex> lock(mutex_);
    stopping_ = true;
  }
  wake_.notify_all();
  if (worker_.joinable()) {
    worker_.join();
  }
}

ImageHandle ImageRegistry::add(std::shared_ptr<tgfx::ImageCodec> codec) {
  if (codec == nullptr) {
    return {};
  }
  auto image = decode(*codec);
  if (image == nullptr) {
    TGFXRN_LOGW("failed to decode a %dx%d image", codec->width(), codec->height());
    return {};
  }
  std::lock_guard<std::mutex> lock(mutex_);
  int32_t handle = nextHandle_++;
  Entry entry;
  entry.codec = std::move(codec);
  entry.width = image->width();
  entry.height = image->height();
  entry.bytes = byteSizeOf(*image);
  entry.decoded = std::move(image);
  decodeCount_++;
  auto& stored = entries_.emplace(handle, std::move(entry)).first->second;
  touchLocked(handle, stored);
  return {handle, stored.width, stored.height};
}

ImageHandle ImageRegistry::addExternal(std::shared_ptr<tgfx::Image> image) {
  if (image == nullptr) {
    return {};
  }
  std::lock_guard<std::mutex> lock(mutex_);
  int32_t handle = nextHandle_++;
  Entry entry;
  entry.width = image->width();
  entry.height = image->height();
  entry.decoded = std::move(image);
  // No `codec`, no `bytes`, never touched into the LRU: the pixels are the
  // producer's, not ours to budget or evict.
  auto& stored = entries_.emplace(handle, std::move(entry)).first->second;
  return {handle, stored.width, stored.height};
}

bool ImageRegistry::replaceExternal(int32_t handle,
                                    std::shared_ptr<tgfx::Image> image) {
  if (image == nullptr) {
    return false;
  }
  // Released after the lock: dropping the last reference to a hardware-buffer
  // image is what hands the slot back to the producer, and it must not happen
  // under a mutex the render thread is about to want.
  std::shared_ptr<tgfx::Image> previous;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = entries_.find(handle);
    if (it == entries_.end() || !it->second.external()) {
      return false;
    }
    it->second.width = image->width();
    it->second.height = image->height();
    // Overwrites whatever the renderer has not drawn yet, rather than queueing.
    previous = std::move(it->second.decoded);
    it->second.decoded = std::move(image);
  }
  // The draw path resolves external handles per frame, so this is what makes the
  // new buffer visible — and what wakes a render loop with nothing else to
  // redraw for.
  bumpEpoch();
  return true;
}

void ImageRegistry::remove(int32_t handle) {
  std::shared_ptr<tgfx::Image> previous;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = entries_.find(handle);
    if (it == entries_.end()) {
      return;
    }
    if (it->second.resident) {
      lru_.erase(it->second.at);
      cachedBytes_ -= it->second.bytes;
    }
    previous = std::move(it->second.decoded);
    wanted_.erase(handle);
    entries_.erase(it);
  }
  bumpEpoch();
}

std::shared_ptr<tgfx::Image> ImageRegistry::acquire(int32_t handle, bool* external) {
  std::lock_guard<std::mutex> lock(mutex_);
  auto it = entries_.find(handle);
  if (it == entries_.end()) {
    return nullptr;
  }
  auto& entry = it->second;
  if (external != nullptr) {
    *external = entry.external();
  }
  if (entry.external()) {
    // Outside the budget entirely, so there is no recency to refresh.
    return entry.decoded;
  }
  if (entry.decoded == nullptr) {
    // Reachable only once the budget has dropped this handle's pixels. The
    // caller is the render thread, so the re-decode goes to the worker and the
    // node skips frames until it lands; decoding here would be the very stall
    // the handle refactor exists to remove.
    scheduleDecodeLocked(handle);
    return nullptr;
  }
  // On a hit too, not only on a miss: recency that only records insertion order
  // is FIFO, which evicts the image most likely to still be on screen.
  touchLocked(handle, entry);
  return entry.decoded;
}

uint64_t ImageRegistry::addWakeListener(std::function<void()> wake) {
  std::lock_guard<std::mutex> lock(listenersMutex_);
  uint64_t token = nextListener_++;
  listeners_.emplace_back(token, std::move(wake));
  return token;
}

void ImageRegistry::removeWakeListener(uint64_t token) {
  std::lock_guard<std::mutex> lock(listenersMutex_);
  for (auto it = listeners_.begin(); it != listeners_.end(); ++it) {
    if (it->first == token) {
      listeners_.erase(it);
      return;
    }
  }
}

void ImageRegistry::wakeAll() {
  // Invoked under the listener lock rather than through a copy: a wake only
  // posts work, there is normally one of them, and a per-frame camera swap
  // should not allocate to say so.
  std::lock_guard<std::mutex> lock(listenersMutex_);
  for (auto& [token, wake] : listeners_) {
    (void)token;
    wake();
  }
}

void ImageRegistry::bumpEpoch() {
  epoch_.fetch_add(1, std::memory_order_release);
  wakeAll();
}

void ImageRegistry::scheduleDecodeLocked(int32_t handle) {
  if (!wanted_.insert(handle).second) {
    return;
  }
  if (!worker_.joinable()) {
    worker_ = std::thread([this] { decodeWorker(); });
  }
  wake_.notify_one();
}

void ImageRegistry::decodeWorker() {
  std::unique_lock<std::mutex> lock(mutex_);
  while (true) {
    wake_.wait(lock, [this] { return stopping_ || !wanted_.empty(); });
    if (stopping_) {
      return;
    }
    int32_t handle = *wanted_.begin();
    auto it = entries_.find(handle);
    if (it == entries_.end() || it->second.codec == nullptr ||
        it->second.decoded != nullptr) {
      wanted_.erase(handle);
      wake_.notify_all();
      continue;
    }
    auto codec = it->second.codec;
    TGFXRN_LOGW("re-decoding image %d, evicted under a %zu-byte budget", handle,
                cacheLimit_);
    lock.unlock();
    auto image = decode(*codec);
    lock.lock();
    wanted_.erase(handle);
    auto at = entries_.find(handle);
    // The handle can have been disposed while the lock was down; `codec`
    // identity is what proves this is still the same image.
    bool landed = false;
    if (image != nullptr && at != entries_.end() && at->second.codec == codec &&
        at->second.decoded == nullptr) {
      at->second.bytes = byteSizeOf(*image);
      at->second.decoded = std::move(image);
      decodeCount_++;
      touchLocked(handle, at->second);
      landed = true;
    }
    wake_.notify_all();
    if (landed) {
      // Outside `mutex_`: a wake schedules a draw, and a render thread that then
      // resolves the handle would deadlock against a lock held here.
      lock.unlock();
      bumpEpoch();
      lock.lock();
    }
  }
}

void ImageRegistry::touchLocked(int32_t handle, Entry& entry) {
  if (entry.resident) {
    if (lru_.front() != handle) {
      lru_.splice(lru_.begin(), lru_, entry.at);
    }
    return;
  }
  lru_.push_front(handle);
  entry.at = lru_.begin();
  entry.resident = true;
  cachedBytes_ += entry.bytes;
  evictLocked();
}

/// Never evicts the head, so one image larger than the whole budget still draws.
void ImageRegistry::evictLocked() {
  while (cachedBytes_ > cacheLimit_ && lru_.size() > 1) {
    int32_t victim = lru_.back();
    lru_.pop_back();
    auto it = entries_.find(victim);
    if (it != entries_.end()) {
      cachedBytes_ -= it->second.bytes;
      it->second.decoded = nullptr;
      it->second.resident = false;
    }
  }
}

void ImageRegistry::setCacheLimit(size_t bytes) {
  {
    std::lock_guard<std::mutex> lock(mutex_);
    cacheLimit_ = bytes;
    evictLocked();
  }
  // TgfxRenderer applies the same number to the GPU context cache, so the change
  // has to reach a render thread that may have nothing else to redraw for.
  bumpEpoch();
}

size_t ImageRegistry::cacheLimit() const {
  std::lock_guard<std::mutex> lock(mutex_);
  return cacheLimit_;
}

size_t ImageRegistry::cachedBytes() const {
  std::lock_guard<std::mutex> lock(mutex_);
  return cachedBytes_;
}

size_t ImageRegistry::byteSize(int32_t handle) const {
  std::lock_guard<std::mutex> lock(mutex_);
  auto it = entries_.find(handle);
  return it == entries_.end() ? 0 : it->second.bytes;
}

size_t ImageRegistry::decodeCount() const {
  std::lock_guard<std::mutex> lock(mutex_);
  return decodeCount_;
}

void ImageRegistry::clear() {
  waitForDecodes();
  std::lock_guard<std::mutex> lock(mutex_);
  entries_.clear();
  lru_.clear();
  cachedBytes_ = 0;
  decodeCount_ = 0;
}

void ImageRegistry::waitForDecodes() {
  std::unique_lock<std::mutex> lock(mutex_);
  wake_.wait(lock, [this] { return wanted_.empty(); });
}

}  // namespace tgfxrn
