#include "TgfxRenderer.hpp"

#include <algorithm>

#include <span>

#include "SceneHash.hpp"
#include "SceneStrings.hpp"
#include "tgfx/core/Canvas.h"
#include "tgfx/core/Image.h"
#include "tgfx/core/ImageFilter.h"
#include "Trace.hpp"
#include "tgfx/core/Paint.h"
#include "tgfx/core/Path.h"
#include "tgfx/core/TileMode.h"
#include "tgfx/platform/HardwareBuffer.h"
#include "tgfx/core/Color.h"
#include "tgfx/core/Matrix.h"
#include "tgfx/core/Surface.h"
#include "tgfx/gpu/Context.h"
#include "tgfx/gpu/Device.h"
#include "tgfx/gpu/Window.h"

namespace tgfxrn {

TgfxRenderer::~TgfxRenderer() {
  // Before the window: a wake landing mid-teardown would schedule a draw on a
  // view that is going away.
  setWakeCallback(nullptr);
  releaseWindow();
}

void TgfxRenderer::setWakeCallback(std::function<void()> wake) {
  auto& registry = ImageRegistry::instance();
  if (wakeToken_ != 0) {
    registry.removeWakeListener(wakeToken_);
    wakeToken_ = 0;
  }
  if (wake != nullptr) {
    wakeToken_ = registry.addWakeListener(std::move(wake));
  }
}

void TgfxRenderer::setWindow(std::shared_ptr<tgfx::Window> window) {
  {
    std::lock_guard<std::mutex> lock(mutex_);
    window_ = std::move(window);
    surface_ = nullptr;
    surfaceDirty_ = false;
    cacheLimitApplied_ = false;
  }
  version_.fetch_add(1, std::memory_order_release);
}

void TgfxRenderer::setScene(std::span<const double> words,
                            const std::vector<std::string>& packedStrings) {
  {
    // Ahead of the word checks: JS has already advanced its cursor and the delta
    // carries no resync, so dropping one desyncs the table permanently.
    //
    // Taking the lock twice rather than once means (table, words) is not applied
    // atomically, so this relies on callers serialising their setScene calls:
    // Android holds the Kotlin lock in TgfxRenderTarget.withPtr across the whole
    // JNI crossing, and TgfxMetalView only ever calls in from the JS thread. The
    // split keeps the O(words) hash below off the mutex the render thread takes
    // every frame in draw(); merge the two scopes if a concurrent caller appears.
    std::lock_guard<std::mutex> lock(mutex_);
    if (applyStringTable(strings_, packedStrings)) {
      stringsHash_ = hashStrings(*strings_);
    }
  }
  // The writer reuses (and grows) one buffer, so only the leading `words[1]`
  // words belong to this program; the rest is stale capacity.
  if (words.size() < 2) {
    return;
  }
  auto used = static_cast<size_t>(words[1]);
  if (used < 2 || used > words.size()) {
    return;
  }
  words = words.first(used);
  uint64_t wordsHash = hashWords(words);
  {
    // A reconciler commit can produce an identical program (an unrelated state
    // change upstream); skipping it avoids a rebuild and a redundant frame.
    std::lock_guard<std::mutex> lock(mutex_);
    uint64_t hash = hashScene(wordsHash, stringsHash_);
    if (hash == sceneHash_) {
      return;
    }
    sceneHash_ = hash;
    pendingScene_.assign(words.begin(), words.end());
    // A pointer copy: the payloads are never re-copied on an unchanged table.
    pendingStrings_ = strings_;
    scenePending_ = true;
  }
  version_.fetch_add(1, std::memory_order_release);
}

void TgfxRenderer::clearScene() {
  {
    std::lock_guard<std::mutex> lock(mutex_);
    pendingScene_.clear();
    pendingStrings_.reset();
    scenePending_ = false;
    sceneHash_ = 0;
    // The caches belong to the render thread, so draw() does the clearing.
    cachesDirty_ = true;
    // `strings_` survives: the next commit's carry-over count is relative to it.
  }
  version_.fetch_add(1, std::memory_order_release);
}

void TgfxRenderer::setOpaque(bool opaque) {
  opaque_ = opaque;
  version_.fetch_add(1, std::memory_order_release);
}

void TgfxRenderer::setValues(const std::vector<double>& values) {
  {
    std::lock_guard<std::mutex> lock(mutex_);
    values_ = values;
  }
  version_.fetch_add(1, std::memory_order_release);
}

void TgfxRenderer::onResize() {
  surfaceDirty_ = true;
  version_.fetch_add(1, std::memory_order_release);
}

void TgfxRenderer::setPixelRatio(float ratio) {
  pixelRatio_ = (ratio > 0.0f) ? ratio : 1.0f;
  version_.fetch_add(1, std::memory_order_release);
}

bool TgfxRenderer::draw() {
  TGFXRN_TRACE("tgfx.draw");
  // The registry epoch moves when the image behind a live handle changes: a
  // hardware buffer swapped for the next camera frame, or an evicted image that
  // finished re-decoding. Both have to redraw without a commit from JS.
  // ponytail: one process-wide counter, so a swap wakes every bound view. Views
  // that draw no images redraw one frame they did not need; per-handle
  // subscriptions if that ever shows up in a trace.
  uint64_t version = version_.load(std::memory_order_acquire) +
                     ImageRegistry::instance().epoch();
  if (version == drawnVersion_) {
    return false;
  }
  std::shared_ptr<tgfx::Window> window;
  bool hasScene = false;
  bool dropCaches = false;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    window = window_;
    drawValues_.assign(values_.begin(), values_.end());
    dropCaches = cachesDirty_;
    cachesDirty_ = false;
    if (scenePending_) {
      drawScene_.swap(pendingScene_);
      drawStrings_ = std::move(pendingStrings_);
      scenePending_ = false;
      hasScene = true;
    }
  }
  // Ahead of the window check, so a recycled but unbound view still drops them.
  if (dropCaches) {
    scene_.clearCaches();
  }
  if (hasScene) {
    // Compiling here keeps image/typeface caches on one thread and keeps the
    // JS thread out of the engine entirely.
    TGFXRN_TRACE("tgfx.setScene");
    scene_.setScene(drawScene_, *drawStrings_);
  } else if (dropCaches) {
    // Nothing staged, so release the string table pinning the base64 payloads.
    drawScene_.clear();
    drawScene_.shrink_to_fit();
    drawStrings_.reset();
  }
  if (window == nullptr) {
    return false;
  }
  auto device = window->getDevice();
  if (device == nullptr) {
    return false;
  }
  auto* context = device->lockContext();
  if (context == nullptr) {
    return false;
  }
  // A decoded image is resident twice — CPU pixels under the registry's LRU and
  // a GPU texture here — so both are held to the one number setImageCacheLimit()
  // moves, rather than to a constant only one of them can see. Tracked by value,
  // not by context identity: a destroyed context can be replaced by a new one at
  // the same address.
  size_t cacheLimit = ImageRegistry::instance().cacheLimit();
  if (!cacheLimitApplied_ || appliedCacheLimit_ != cacheLimit) {
    context->setCacheLimit(cacheLimit);
    appliedCacheLimit_ = cacheLimit;
    cacheLimitApplied_ = true;
  }

  if (surfaceDirty_.exchange(false)) {
    surface_ = nullptr;
  }
  if (surface_ == nullptr) {
    surface_ = tgfx::Surface::MakeFrom(context, window);
  }
  bool rendered = false;
  if (surface_ != nullptr) {
    auto* canvas = surface_->getCanvas();
    canvas->clear(opaque_ ? tgfx::Color::Black() : tgfx::Color::Transparent());
    // Scene coordinates are in logical pixels (dp); the tgfx surface is in
    // physical pixels. Scale by the device pixel ratio so they align.
    // One load: a concurrent setPixelRatio must not unbalance save/restore.
    float pixelRatio = pixelRatio_.load(std::memory_order_relaxed);
    if (pixelRatio != 1.0f) {
      canvas->save();
      canvas->concat(tgfx::Matrix::MakeScale(pixelRatio, pixelRatio));
    }
    {
      TGFXRN_TRACE("tgfx.render");
      scene_.render(canvas, drawValues_);
    }
    if (pixelRatio != 1.0f) {
      canvas->restore();
    }
    auto recording = [&] {
      TGFXRN_TRACE("tgfx.flush");
      return context->flush();
    }();
    if (recording != nullptr) {
      TGFXRN_TRACE("tgfx.submit");
      context->submit(std::move(recording));
    }
    rendered = true;
  }
  device->unlock();
  if (rendered) {
    drawnVersion_ = version;
  }
  return rendered;
}

void TgfxRenderer::drawCameraFrame(void* hardwareBuffer, float frameWidth, float frameHeight,
                                   const std::vector<float>& contours, float blurRadius) {
  if (hardwareBuffer == nullptr || frameWidth <= 0 || frameHeight <= 0) {
    return;
  }
  std::shared_ptr<tgfx::Window> window;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    window = window_;
  }
  if (window == nullptr) {
    return;
  }
  auto device = window->getDevice();
  if (device == nullptr) {
    return;
  }
  auto* context = device->lockContext();
  if (context == nullptr) {
    return;
  }
  auto image = tgfx::Image::MakeFrom(static_cast<tgfx::HardwareBufferRef>(hardwareBuffer),
                                    tgfx::YUVColorSpace::BT601_LIMITED);
  if (surfaceDirty_.exchange(false)) {
    surface_ = nullptr;
  }
  if (surface_ == nullptr) {
    surface_ = tgfx::Surface::MakeFrom(context, window);
  }
  if (image != nullptr && surface_ != nullptr) {
    auto* canvas = surface_->getCanvas();
    canvas->clear(tgfx::Color::Black());
    auto surfaceWidth = static_cast<float>(surface_->width());
    auto surfaceHeight = static_cast<float>(surface_->height());
    // Center-crop the frame into the surface. Everything below is drawn through
    // this same matrix, contours included.
    float scale = std::max(surfaceWidth / frameWidth, surfaceHeight / frameHeight);
    canvas->save();
    canvas->translate((surfaceWidth - frameWidth * scale) * 0.5f,
                      (surfaceHeight - frameHeight * scale) * 0.5f);
    canvas->scale(scale, scale);
    canvas->drawImage(image);

    if (blurRadius > 0) {
      tgfx::Paint blurPaint;
      // Clamp, not the default Decal: Decal makes the blur transparent outside
      // the source, so a large radius stops covering what it is meant to hide.
      blurPaint.setImageFilter(
          tgfx::ImageFilter::Blur(blurRadius, blurRadius, tgfx::TileMode::Clamp));
      size_t i = 0;
      while (i < contours.size()) {
        auto count = static_cast<size_t>(contours[i++]);
        if (count < 3 || i + count * 2 > contours.size()) {
          break;
        }
        tgfx::Path path;
        path.moveTo(contours[i], contours[i + 1]);
        for (size_t p = 1; p < count; p++) {
          path.lineTo(contours[i + p * 2], contours[i + p * 2 + 1]);
        }
        path.close();
        i += count * 2;
        canvas->save();
        canvas->clipPath(path);
        canvas->drawImage(image, &blurPaint);
        canvas->restore();
      }
    }
    canvas->restore();
    auto recording = context->flush();
    if (recording != nullptr) {
      context->submit(std::move(recording));
    }
  }
  device->unlock();
}

void TgfxRenderer::releaseWindow() {
  std::shared_ptr<tgfx::Window> window;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    window = window_;
  }
  // Drop the surface on a locked context when still possible. The scene's
  // images and typefaces are context-free, so they stay for the next window.
  if (window != nullptr) {
    auto device = window->getDevice();
    if (device != nullptr) {
      auto* context = device->lockContext();
      if (context != nullptr) {
        surface_ = nullptr;
        device->unlock();
      }
    }
  }
  std::lock_guard<std::mutex> lock(mutex_);
  surface_ = nullptr;
  window_ = nullptr;
  cacheLimitApplied_ = false;
}

}  // namespace tgfxrn
