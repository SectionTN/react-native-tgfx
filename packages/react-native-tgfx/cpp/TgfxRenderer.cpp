#include "TgfxRenderer.hpp"

#include "tgfx/core/Canvas.h"
#include "tgfx/core/Color.h"
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
  dirty_ = true;
}

void TgfxRenderer::setScene(const std::string& sceneJson) {
  {
    std::lock_guard<std::mutex> lock(mutex_);
    if (sceneJson == lastScene_) {
      return;
    }
    lastScene_ = sceneJson;
  }
  // Compile the scene into the native command list once, off the render path.
  scene_.setScene(sceneJson);
  dirty_ = true;
}

void TgfxRenderer::setValues(const std::vector<double>& values) {
  {
    std::lock_guard<std::mutex> lock(mutex_);
    values_ = values;
  }
  dirty_ = true;
}

void TgfxRenderer::onResize() {
  surfaceDirty_ = true;
  dirty_ = true;
}

bool TgfxRenderer::draw() {
  // Fast path: nothing changed since the last frame — skip all GPU work.
  if (!dirty_.load()) {
    return false;
  }
  std::shared_ptr<tgfx::Window> window;
  std::vector<double> values;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    window = window_;
    values = values_;
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
  // Committed to drawing this frame — clear the dirty flag (single render
  // thread, so this can't drop a concurrent update).
  dirty_.store(false);

  if (surfaceDirty_.exchange(false)) {
    surface_ = nullptr;
  }
  if (surface_ == nullptr) {
    surface_ = tgfx::Surface::MakeFrom(context, window);
  }
  bool rendered = false;
  if (surface_ != nullptr) {
    auto* canvas = surface_->getCanvas();
    canvas->clear(tgfx::Color::Transparent());
    scene_.render(canvas, values);
    auto recording = context->flush();
    if (recording != nullptr) {
      context->submit(std::move(recording));
    }
    rendered = true;
  }
  device->unlock();
  return rendered;
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
