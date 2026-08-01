#include "TgfxRenderer.hpp"

#include <algorithm>

#include <span>

#include "SceneHash.hpp"
#include "tgfx/core/Canvas.h"
#include "tgfx/core/Image.h"
#include "tgfx/core/ImageFilter.h"
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
  releaseWindow();
}

void TgfxRenderer::setWindow(std::shared_ptr<tgfx::Window> window) {
  {
    std::lock_guard<std::mutex> lock(mutex_);
    window_ = std::move(window);
    surface_ = nullptr;
    surfaceDirty_ = false;
  }
  version_.fetch_add(1, std::memory_order_release);
}

void TgfxRenderer::setScene(std::span<const double> words,
                            const std::vector<std::string>& strings) {
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
  uint64_t hash = hashScene(words, strings);
  {
    // A reconciler commit can produce an identical program (an unrelated state
    // change upstream); skipping it avoids a rebuild and a redundant frame.
    std::lock_guard<std::mutex> lock(mutex_);
    if (hash == sceneHash_) {
      return;
    }
    sceneHash_ = hash;
    pendingScene_.assign(words.begin(), words.end());
    pendingStrings_ = strings;
    scenePending_ = true;
  }
  version_.fetch_add(1, std::memory_order_release);
}

void TgfxRenderer::clearScene() {
  {
    std::lock_guard<std::mutex> lock(mutex_);
    pendingScene_.clear();
    pendingStrings_.clear();
    scenePending_ = false;
    sceneHash_ = 0;
  }
  scene_.clearCaches();
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
  uint64_t version = version_.load(std::memory_order_acquire);
  if (version == drawnVersion_) {
    return false;
  }
  std::shared_ptr<tgfx::Window> window;
  std::vector<double> values;
  std::vector<double> scene;
  std::vector<std::string> strings;
  bool hasScene = false;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    window = window_;
    values = values_;
    if (scenePending_) {
      scene = std::move(pendingScene_);
      strings = std::move(pendingStrings_);
      scenePending_ = false;
      hasScene = true;
    }
  }
  if (hasScene) {
    // Compiling here keeps image/typeface caches on one thread and keeps the
    // JS thread out of the engine entirely.
    scene_.setScene(scene, strings);
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
    if (pixelRatio_ != 1.0f) {
      canvas->save();
      canvas->concat(tgfx::Matrix::MakeScale(pixelRatio_, pixelRatio_));
    }
    scene_.render(canvas, values);
    if (pixelRatio_ != 1.0f) {
      canvas->restore();
    }
    auto recording = context->flush();
    if (recording != nullptr) {
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
  // Release GPU resources on a locked context when still possible.
  if (window != nullptr) {
    auto device = window->getDevice();
    if (device != nullptr) {
      auto* context = device->lockContext();
      if (context != nullptr) {
        surface_ = nullptr;
        scene_.clearCaches();
        device->unlock();
      }
    }
  }
  std::lock_guard<std::mutex> lock(mutex_);
  surface_ = nullptr;
  window_ = nullptr;
}

}  // namespace tgfxrn
