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
  // A new window means a new Context, and a readback is bound to the one it was
  // issued on: SurfaceReadback::isReady() rejects a foreign context and keeps
  // returning false, so an orphaned entry would never drain, snapshotPending_
  // would latch true, and the platform loop would re-post itself for the life of
  // the process. A context change is terminal for anything in flight.
  auto orphaned = takeSnapshots();
  std::shared_ptr<tgfx::Window> previous;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    previous = std::move(window_);
    window_ = std::move(window);
    surfaceDirty_ = false;
    cacheLimitApplied_ = false;
  }
  // Drops surface_ and the orphaned readbacks on the outgoing context.
  releaseGpuObjects(previous, orphaned);
  failSnapshots(std::move(orphaned),
                "[tgfx] snapshot: the canvas surface was replaced before the frame landed");
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
    // The font epoch deliberately stays out of this hash: draw() recompiles on
    // an epoch move from the buffers it already holds, which covers the commit
    // that arrives after a load *and* the load that no commit follows.
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
  // The font epoch moves when a typeface finishes loading. loadFont() and
  // loadFonts() are promises with no state change behind them, so nothing else
  // ever commits — without this a face registered over already-mounted <Text>
  // would leave it in the platform fallback for the life of the process.
  uint64_t fontEpoch = FontRegistry::instance().epoch();
  uint64_t version = version_.load(std::memory_order_acquire) +
                     ImageRegistry::instance().epoch() + fontEpoch;
  // A snapshot needs frames the scene does not: one to issue the readback into,
  // then however many ticks the GPU transfer takes to land.
  if (version == drawnVersion_ && !snapshotPending()) {
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
  // Waking the loop is not enough: a redraw replays a TextCmd whose layout was
  // memoised against the typeface the old epoch resolved. Both buffers survive
  // the swap above, so recompiling costs one parse of a program we still hold.
  if (!hasScene && fontEpoch != compiledFontEpoch_ && drawStrings_ != nullptr) {
    hasScene = true;
  }
  compiledFontEpoch_ = fontEpoch;
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
    // Also stops the snapshot loop re-posting itself against a GPU it cannot lock.
    failSnapshots(window, "[tgfx] snapshot: the GPU context could not be locked");
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
  // Ahead of this frame's drawing: a readback issued last frame is independent
  // of it, and collecting first keeps the encode worker one tick closer.
  collectSnapshots(context);

  // Read before the surface is (re)created, so a barrier raised after this point
  // is not cleared by a surface that predates it.
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
    // The context is locked here, so the GPU halves go now and the callbacks go
    // to their worker after the unlock below.
    orphaned = takeSnapshots();
    dropGpuHandles(orphaned);
  }
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
    // Inside the frame, before the flush that presents it: the window surface is
    // the swapchain drawable, so after submit() there is nothing left to read.
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
  // A snapshot always forces a fresh frame: there is no previous frame's texture
  // left to read once the drawable has been presented.
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
  // The surface this frame renders into was created before the barrier was
  // raised, so it may still be backed by a framebuffer-only Metal drawable —
  // blitting out of one wedges the GPU device for every canvas in the process.
  // Leave the requests staged; snapshotPending_ keeps the loop going and the
  // next frame's surface, created after the flip, takes them.
  if (surfaceBarrier_ != snapshotBarrier_.load(std::memory_order_acquire)) {
    return;
  }
  std::vector<std::pair<SnapshotRequest, SnapshotCallback>> staged;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    staged.swap(pendingSnapshots_);
  }
  // The request is in logical pixels; the surface is in physical ones.
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
      // A resize is the one case that needs a target of its own; everything else
      // reads the frame that was going to be drawn anyway.
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
    // isReady() is what keeps this short, not free: once the readback buffer
    // exists, SurfaceReadback::lockPixels always waits on the whole GPU queue
    // (queue()->waitUntilCompleted()), so this is a full pipeline sync on the
    // render thread — over quickly because the work it waits on has landed, but
    // it does happen. The copy is what keeps the encode out of it.
    const void* pixels = entry.readback->lockPixels(context, entry.flipY);
    auto copy = pixels != nullptr
                    ? tgfx::Data::MakeWithCopy(pixels, info.byteSize())
                    : nullptr;
    entry.readback->unlockPixels(context);
    // tgfx's bounded pool, not one detached thread per snapshot: snapshot() per
    // frame is the obvious use for this API. Captures nothing owned by this
    // renderer, so the view may be dropped while a large PNG is still encoding.
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
  // A staged request owns no GPU objects yet, but it fails the same way.
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
  // A readback owns a GPU buffer and a scaled snapshot owns its own render
  // target, so both need the context current — the same reason surface_ is
  // dropped here rather than wherever the window reference goes away. Best
  // effort: a context that will not lock belongs to a device that is already
  // gone, and the render thread is still the least wrong place to free them.
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
  // Errors take the same worker hop as a successful readback. On Android the
  // callback attaches the caller to the JVM and upcalls into Kotlin, and the
  // caller here is the render thread every canvas in the process shares.
  tgfx::Task::Run([callback = std::move(callback), error = std::move(error)] {
    callback(nullptr, 0, 0, error);
  });
}

void TgfxRenderer::failSnapshots(std::vector<InFlightSnapshot> entries,
                                 const std::string& error) {
  for (auto& entry : entries) {
    deliverError(std::move(entry.callback), error);
  }
  // Whatever GPU handles survived go with `entries`, here, not on a worker.
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
  // Drop the surface and the readbacks on a locked context while that is still
  // possible. The scene's images and typefaces are context-free, so they stay
  // for the next window.
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
