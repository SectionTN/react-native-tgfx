#include "TgfxRenderer.hpp"

#include <algorithm>
#include <cmath>
#include <utility>

#include <span>

#include "FontRegistry.hpp"
#include "SceneHash.hpp"
#include "SceneStrings.hpp"
#include "tgfx/core/Canvas.h"
#include "tgfx/core/Image.h"
#include "Trace.hpp"
#include "tgfx/core/Color.h"
#include "tgfx/core/Matrix.h"
#include "tgfx/core/Rect.h"
#include "tgfx/core/Surface.h"
#include "tgfx/core/SurfaceReadback.h"
#include "tgfx/core/Task.h"
#include "tgfx/gpu/Context.h"
#include "tgfx/gpu/Device.h"
#include "tgfx/gpu/Window.h"

namespace tgfxrn {

TgfxRenderer::~TgfxRenderer() {
  // Before the window: a wake landing mid-teardown would draw into a dying view.
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
    // The registry wakes every canvas in the process. One that draws no image
    // would only reach draw()'s early-out, having cost a post and a JNI hop on
    // a render thread that is already the busiest one here.
    wakeToken_ = registry.addWakeListener([this, wake = std::move(wake)] {
      if (usesImages_.load(std::memory_order_acquire)) {
        wake();
      }
    });
  }
}

void TgfxRenderer::setWindow(std::shared_ptr<tgfx::Window> window) {
  // Terminal for in-flight readbacks: bound to the old context, an orphan never drains.
  auto orphaned = takeSnapshots();
  std::shared_ptr<tgfx::Window> previous;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    previous = std::move(window_);
    window_ = std::move(window);
    surfaceDirty_ = false;
    cacheLimitApplied_ = false;
  }
  releaseGpuObjects(previous, orphaned);
  failSnapshots(std::move(orphaned),
                "[tgfx] snapshot: the canvas surface was replaced before the frame landed");
  version_.fetch_add(1, std::memory_order_release);
}

void TgfxRenderer::setScene(std::span<const double> words,
                            const std::vector<std::string>& packedStrings) {
  {
    // Ahead of the word checks: the delta carries no resync, so a dropped one desyncs it.
    std::lock_guard<std::mutex> lock(mutex_);
    if (applyStringTable(strings_, packedStrings)) {
      stringsHash_ = hashStrings(*strings_);
    }
  }
  if (words.size() < 2) {
    return;
  }
  // Casting a NaN or out-of-range double to size_t is undefined behaviour.
  double usedWord = words[1];
  if (!std::isfinite(usedWord) || usedWord < 2 ||
      usedWord > static_cast<double>(words.size())) {
    return;
  }
  auto used = static_cast<size_t>(usedWord);
  words = words.first(used);
  uint64_t wordsHash = hashWords(words);
  {
    std::lock_guard<std::mutex> lock(mutex_);
    // The font epoch stays out: draw() recompiles on an epoch move from the buffers it holds.
    uint64_t hash = hashScene(wordsHash, stringsHash_);
    if (hash == sceneHash_) {
      return;
    }
    sceneHash_ = hash;
    pendingScene_.assign(words.begin(), words.end());
    pendingStrings_ = strings_;
    scenePending_ = true;
    // A re-encode bakes current values as literals and may reassign slot
    // indices, so stale pushes must not outrank the new program's words.
    std::fill(stringPushed_.begin(), stringPushed_.end(), 0);
    stringGen_++;
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
    cachesDirty_ = true;
  }
  version_.fetch_add(1, std::memory_order_release);
}

void TgfxRenderer::setOpaque(bool opaque) {
  opaque_ = opaque;
  version_.fetch_add(1, std::memory_order_release);
}

void TgfxRenderer::setValues(std::vector<double> values) {
  {
    std::lock_guard<std::mutex> lock(mutex_);
    values_ = std::move(values);
    valuesGen_++;
  }
  version_.fetch_add(1, std::memory_order_release);
}

void TgfxRenderer::setStringValues(const std::vector<double>& indices,
                                   const std::vector<std::string>& values) {
  {
    std::lock_guard<std::mutex> lock(mutex_);
    size_t count = std::min(indices.size(), values.size());
    for (size_t i = 0; i < count; i++) {
      double raw = indices[i];
      if (!(raw >= 0 && raw < 65536)) {
        continue;
      }
      size_t at = static_cast<size_t>(raw);
      if (stringValues_.size() <= at) {
        // The gap fill is inert: only slots marked pushed are ever read.
        stringValues_.resize(at + 1);
        stringPushed_.resize(at + 1, 0);
      }
      stringValues_[at] = values[i];
      stringPushed_[at] = 1;
    }
    stringGen_++;
  }
  version_.fetch_add(1, std::memory_order_release);
}

std::vector<double> TgfxRenderer::hitTest(float x, float y, bool precise) {
  std::vector<double> snapshot;
  std::vector<std::string> strings;
  std::vector<uint8_t> pushed;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    snapshot = values_;
    strings = stringValues_;
    pushed = stringPushed_;
  }
  return scene_.hitTest(x, y, precise, snapshot, strings, pushed);
}

void TgfxRenderer::setColorSpace(bool displayP3) {
  // Only read when the window is built. A Surface rebuilt from the same window keeps
  // that window's space, so changing this later cannot take effect and must not pretend to.
  displayP3_.store(displayP3, std::memory_order_relaxed);
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
  // Both epochs move with no commit behind them: a swapped buffer, a re-decode, a loaded face.
  // Both are also process-wide, so they are only this canvas's business when its own scene
  // reads that registry — otherwise one video frame redraws every canvas in the app.
  uint64_t fontEpoch = FontRegistry::instance().epoch();
  uint64_t version = version_.load(std::memory_order_acquire);
  uint64_t imageMark =
      usesImages_.load(std::memory_order_acquire) ? ImageRegistry::instance().epoch() : 0;
  uint64_t fontMark = usesText_.load(std::memory_order_acquire) ? fontEpoch : 0;
  if (version == drawnVersion_ && imageMark == drawnImageMark_ &&
      fontMark == drawnFontMark_ && !snapshotPending()) {
    return false;
  }
  std::shared_ptr<tgfx::Window> window;
  bool hasScene = false;
  bool dropCaches = false;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    window = window_;
    if (drawValuesGen_ != valuesGen_) {
      drawValues_.assign(values_.begin(), values_.end());
      drawValuesGen_ = valuesGen_;
    }
    // Strings copy only when a push moved the generation; idle frames skip it.
    if (drawStringGen_ != stringGen_) {
      drawStringValues_.assign(stringValues_.begin(), stringValues_.end());
      drawStringPushed_.assign(stringPushed_.begin(), stringPushed_.end());
      drawStringGen_ = stringGen_;
    }
    dropCaches = cachesDirty_;
    cachesDirty_ = false;
    if (scenePending_) {
      drawScene_.swap(pendingScene_);
      drawStrings_ = std::move(pendingStrings_);
      scenePending_ = false;
      hasScene = true;
    }
  }
  // A replay would reuse a layout memoised against the old epoch's typeface, so recompile.
  if (!hasScene && fontEpoch != compiledFontEpoch_ && drawStrings_ != nullptr) {
    hasScene = true;
  }
  compiledFontEpoch_ = fontEpoch;
  if (dropCaches) {
    scene_.clearCaches();
  }
  if (hasScene) {
    TGFXRN_TRACE("tgfx.setScene");
    scene_.setScene(drawScene_, *drawStrings_);
    usesImages_.store(scene_.usesImages(), std::memory_order_release);
    usesText_.store(scene_.usesText(), std::memory_order_release);
  } else if (dropCaches) {
    drawScene_.clear();
    drawScene_.shrink_to_fit();
    drawStrings_.reset();
  }
  if (window == nullptr) {
    failSnapshots(window, "[tgfx] snapshot: the canvas has no surface bound yet");
    return false;
  }
  auto device = window->getDevice();
  if (device == nullptr) {
    failSnapshots(window, "[tgfx] snapshot: the canvas has no GPU device");
    return false;
  }
  auto* context = device->lockContext();
  if (context == nullptr) {
    failSnapshots(window, "[tgfx] snapshot: the GPU context could not be locked");
    return false;
  }
  // A decoded image is resident twice, CPU and GPU, so both follow setImageCacheLimit().
  size_t cacheLimit = ImageRegistry::instance().cacheLimit();
  if (!cacheLimitApplied_ || appliedCacheLimit_ != cacheLimit) {
    context->setCacheLimit(cacheLimit);
    appliedCacheLimit_ = cacheLimit;
    cacheLimitApplied_ = true;
  }
  collectSnapshots(context);

  // Read before the surface is (re)created, so a later barrier is not cleared by it.
  uint64_t barrier = snapshotBarrier_.load(std::memory_order_acquire);
  if (surfaceDirty_.exchange(false)) {
    surface_ = nullptr;
  }
  if (surface_ == nullptr) {
    surface_ = tgfx::Surface::MakeFrom(context, window);
    surfaceBarrier_ = barrier;
  }
  bool rendered = false;
  std::vector<InFlightSnapshot> orphaned;
  if (surface_ == nullptr) {
    orphaned = takeSnapshots();
    dropGpuHandles(orphaned);
  }
  if (surface_ != nullptr) {
    auto* canvas = surface_->getCanvas();
    canvas->clear(opaque_ ? tgfx::Color::Black() : tgfx::Color::Transparent());
    // Scene coordinates are logical pixels, the surface physical. One load, or save/restore skews.
    float pixelRatio = pixelRatio_.load(std::memory_order_relaxed);
    if (pixelRatio != 1.0f) {
      canvas->save();
      canvas->concat(tgfx::Matrix::MakeScale(pixelRatio, pixelRatio));
    }
    {
      TGFXRN_TRACE("tgfx.render");
      scene_.render(canvas, drawValues_, drawStringValues_, drawStringGen_,
                    drawStringPushed_);
    }
    if (pixelRatio != 1.0f) {
      canvas->restore();
    }
    startSnapshots(context);
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
  if (!orphaned.empty()) {
    failSnapshots(std::move(orphaned),
                  "[tgfx] snapshot: the canvas surface is zero-sized or unavailable");
  }
  if (rendered) {
    drawnVersion_ = version;
    drawnImageMark_ = imageMark;
    drawnFontMark_ = fontMark;
  }
  return rendered;
}

void TgfxRenderer::requestSnapshot(const SnapshotRequest& request,
                                   SnapshotCallback callback) {
  if (callback == nullptr) {
    return;
  }
  {
    std::lock_guard<std::mutex> lock(mutex_);
    pendingSnapshots_.emplace_back(request, std::move(callback));
  }
  snapshotPending_.store(true, std::memory_order_release);
  version_.fetch_add(1, std::memory_order_release);
}

void TgfxRenderer::updateSnapshotPending() {
  bool pending = !inFlightSnapshots_.empty();
  if (!pending) {
    std::lock_guard<std::mutex> lock(mutex_);
    pending = !pendingSnapshots_.empty();
  }
  snapshotPending_.store(pending, std::memory_order_release);
}

void TgfxRenderer::startSnapshots(tgfx::Context* context) {
  // A surface predating the barrier may be a framebuffer-only drawable; blitting one wedges the GPU.
  if (surfaceBarrier_ != snapshotBarrier_.load(std::memory_order_acquire)) {
    return;
  }
  std::vector<std::pair<SnapshotRequest, SnapshotCallback>> staged;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    staged.swap(pendingSnapshots_);
  }
  float ratio = pixelRatio_.load(std::memory_order_relaxed);
  for (auto& [request, callback] : staged) {
    auto bounds = tgfx::Rect::MakeWH(static_cast<float>(surface_->width()),
                                     static_cast<float>(surface_->height()));
    auto source = snapshotSourceRect(request, ratio, bounds);
    if (source.isEmpty()) {
      deliverError(std::move(callback), "[tgfx] snapshot: rect lies outside the canvas");
      continue;
    }
    InFlightSnapshot entry;
    entry.request = request;
    entry.callback = std::move(callback);
    if (request.scale == 1.0f) {
      entry.readback = surface_->asyncReadPixels(source);
      entry.flipY = surface_->origin() == tgfx::ImageOrigin::BottomLeft;
    } else {
      int width = static_cast<int>(std::lround(source.width() * request.scale));
      int height = static_cast<int>(std::lround(source.height() * request.scale));
      auto scratch = width > 0 && height > 0
                         ? tgfx::Surface::Make(context, width, height)
                         : nullptr;
      auto image = scratch != nullptr ? surface_->makeImageSnapshot() : nullptr;
      if (image == nullptr) {
        deliverError(std::move(entry.callback),
                     "[tgfx] snapshot: could not allocate a scaled target");
        continue;
      }
      auto* scratchCanvas = scratch->getCanvas();
      scratchCanvas->clear();
      scratchCanvas->scale(request.scale, request.scale);
      scratchCanvas->translate(-source.x(), -source.y());
      scratchCanvas->drawImage(image);
      entry.readback = scratch->asyncReadPixels(
          tgfx::Rect::MakeWH(static_cast<float>(width), static_cast<float>(height)));
      entry.flipY = scratch->origin() == tgfx::ImageOrigin::BottomLeft;
      entry.scratch = std::move(scratch);
    }
    if (entry.readback == nullptr) {
      deliverError(std::move(entry.callback),
                   "[tgfx] snapshot: the GPU refused the readback");
      continue;
    }
    inFlightSnapshots_.push_back(std::move(entry));
  }
  updateSnapshotPending();
}

void TgfxRenderer::collectSnapshots(tgfx::Context* context) {
  if (inFlightSnapshots_.empty()) {
    return;
  }
  std::vector<InFlightSnapshot> waiting;
  for (auto& entry : inFlightSnapshots_) {
    if (!entry.readback->isReady(context)) {
      waiting.push_back(std::move(entry));
      continue;
    }
    auto info = entry.readback->info();
    // lockPixels always waits on the whole GPU queue; the copy keeps the encode out of that.
    const void* pixels = entry.readback->lockPixels(context, entry.flipY);
    auto copy = pixels != nullptr
                    ? tgfx::Data::MakeWithCopy(pixels, info.byteSize())
                    : nullptr;
    entry.readback->unlockPixels(context);
    tgfx::Task::Run([copy = std::move(copy), info, request = std::move(entry.request),
                     callback = std::move(entry.callback)] {
      finishSnapshot(copy, info, request, callback);
    });
  }
  inFlightSnapshots_ = std::move(waiting);
  updateSnapshotPending();
}

std::vector<TgfxRenderer::InFlightSnapshot> TgfxRenderer::takeSnapshots() {
  auto taken = std::move(inFlightSnapshots_);
  inFlightSnapshots_.clear();
  std::vector<std::pair<SnapshotRequest, SnapshotCallback>> staged;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    staged.swap(pendingSnapshots_);
  }
  for (auto& [request, callback] : staged) {
    InFlightSnapshot entry;
    entry.request = std::move(request);
    entry.callback = std::move(callback);
    taken.push_back(std::move(entry));
  }
  snapshotPending_.store(false, std::memory_order_release);
  return taken;
}

void TgfxRenderer::dropGpuHandles(std::vector<InFlightSnapshot>& entries) {
  for (auto& entry : entries) {
    entry.readback = nullptr;
    entry.scratch = nullptr;
  }
}

void TgfxRenderer::releaseGpuObjects(const std::shared_ptr<tgfx::Window>& window,
                                     std::vector<InFlightSnapshot>& entries) {
  // Both own GPU objects, so both need the context current. Best effort: the device may be gone.
  auto device = window != nullptr ? window->getDevice() : nullptr;
  auto* context = device != nullptr ? device->lockContext() : nullptr;
  surface_ = nullptr;
  dropGpuHandles(entries);
  if (context != nullptr) {
    device->unlock();
  }
}

void TgfxRenderer::deliverError(SnapshotCallback callback, std::string error) {
  if (callback == nullptr) {
    return;
  }
  tgfx::Task::Run([callback = std::move(callback), error = std::move(error)] {
    callback(nullptr, 0, 0, error);
  });
}

void TgfxRenderer::failSnapshots(std::vector<InFlightSnapshot> entries,
                                 const std::string& error) {
  for (auto& entry : entries) {
    deliverError(std::move(entry.callback), error);
  }
}

void TgfxRenderer::failSnapshots(const std::shared_ptr<tgfx::Window>& window,
                                 const std::string& error) {
  auto orphaned = takeSnapshots();
  if (orphaned.empty()) {
    return;
  }
  releaseGpuObjects(window, orphaned);
  failSnapshots(std::move(orphaned), error);
}

void TgfxRenderer::deferSnapshotsToNextSurface() {
  snapshotBarrier_.fetch_add(1, std::memory_order_release);
  onResize();
}

void TgfxRenderer::releaseWindow() {
  auto orphaned = takeSnapshots();
  std::shared_ptr<tgfx::Window> window;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    window = window_;
  }
  releaseGpuObjects(window, orphaned);
  {
    std::lock_guard<std::mutex> lock(mutex_);
    window_ = nullptr;
    cacheLimitApplied_ = false;
  }
  failSnapshots(std::move(orphaned),
                "[tgfx] snapshot: the canvas was unmounted before the frame landed");
}

}  // namespace tgfxrn
