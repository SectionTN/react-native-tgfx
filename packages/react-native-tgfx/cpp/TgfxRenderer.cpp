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
  std::lock_guard<std::mutex> lock(mutex_);
  window_ = std::move(window);
  surface_ = nullptr;
  surfaceDirty_ = false;
}

void TgfxRenderer::setScene(const std::string& sceneJson) {
  std::lock_guard<std::mutex> lock(mutex_);
  sceneJson_ = sceneJson;
}

void TgfxRenderer::setValues(const std::vector<double>& values) {
  std::lock_guard<std::mutex> lock(mutex_);
  values_ = values;
}

void TgfxRenderer::onResize() {
  surfaceDirty_ = true;
}

void TgfxRenderer::draw() {
  std::shared_ptr<tgfx::Window> window;
  std::string sceneJson;
  std::vector<double> values;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    window = window_;
    sceneJson = sceneJson_;
    values = values_;
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

  if (surfaceDirty_.exchange(false)) {
    surface_ = nullptr;
  }
  if (surface_ == nullptr) {
    surface_ = tgfx::Surface::MakeFrom(context, window);
  }
  if (surface_ != nullptr) {
    auto* canvas = surface_->getCanvas();
    canvas->clear(tgfx::Color::Transparent());
    scene_.render(canvas, sceneJson, values);
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
