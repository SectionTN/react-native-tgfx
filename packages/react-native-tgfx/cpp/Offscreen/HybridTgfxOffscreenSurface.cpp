#include "HybridTgfxOffscreenSurface.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

#include "HybridTgfxImage.hpp"

namespace margelo::nitro::tgfx {

void HybridTgfxOffscreenSurface::setScene(const std::shared_ptr<ArrayBuffer>& scene,
                                          const std::vector<std::string>& strings) {
  if (scene == nullptr || scene->size() < sizeof(double)) {
    surface_->setScene({}, strings);
    return;
  }
  // The buffer is JS-owned and only valid for this call; the engine copies.
  const auto* data = reinterpret_cast<const double*>(scene->data());
  surface_->setScene({data, scene->size() / sizeof(double)}, strings);
}

void HybridTgfxOffscreenSurface::setValues(const std::vector<double>& values) {
  surface_->setValues(values);
}

void HybridTgfxOffscreenSurface::setStringValues(const std::vector<double>& indices,
                                                 const std::vector<std::string>& values) {
  surface_->setStringValues(indices, values);
}

void HybridTgfxOffscreenSurface::setViewport(const std::vector<double>& viewport) {
  // The view's contract: fewer than three entries is ignored.
  if (viewport.size() < 3) {
    return;
  }
  surface_->setViewport(static_cast<float>(viewport[0]), static_cast<float>(viewport[1]),
                        static_cast<float>(viewport[2]));
}

std::vector<double> HybridTgfxOffscreenSurface::hitTest(double x, double y, bool precise) {
  return surface_->hitTest(static_cast<float>(x), static_cast<float>(y), precise);
}

void HybridTgfxOffscreenSurface::flush() {
  surface_->flush();
}

std::shared_ptr<Promise<std::shared_ptr<HybridTgfxImageSpec>>>
HybridTgfxOffscreenSurface::toImage() {
  auto promise = Promise<std::shared_ptr<HybridTgfxImageSpec>>::create();
  surface_->requestImage([promise](tgfxrn::ImageHandle handle, const std::string& error) {
    if (!error.empty()) {
      promise->reject(std::make_exception_ptr(std::runtime_error(error)));
      return;
    }
    promise->resolve(std::make_shared<HybridTgfxImage>(handle));
  });
  return promise;
}

std::shared_ptr<Promise<void>> HybridTgfxOffscreenSurface::save(
    const std::string& path, const std::optional<std::string>& format,
    std::optional<double> quality) {
  tgfxrn::SnapshotRequest request;
  request.format = format.value_or("png");
  double q = quality.value_or(100);
  request.quality =
      static_cast<int>(std::min(100.0, std::max(1.0, std::isfinite(q) ? q : 100)));
  request.path = path;
  auto promise = Promise<void>::create();
  if (path.empty()) {
    // Rejected, not thrown: every other save failure reaches the catch block.
    promise->reject(std::make_exception_ptr(
        std::runtime_error("tgfx: save needs a file path")));
    return promise;
  }
  surface_->requestSave(request, [promise](std::shared_ptr<::tgfx::Data>, int, int,
                                           const std::string& error) {
    if (!error.empty()) {
      promise->reject(std::make_exception_ptr(std::runtime_error(error)));
      return;
    }
    promise->resolve();
  });
  return promise;
}

std::shared_ptr<HybridTgfxOffscreenSurfaceSpec> HybridTgfxOffscreenSurfaceFactory::create(
    double width, double height, double pixelRatio, bool opaque,
    const std::string& colorSpace) {
  if (!std::isfinite(width) || !std::isfinite(height) || width <= 0 || height <= 0) {
    throw std::runtime_error(
        "tgfx: createOffscreenSurface needs a finite size above zero");
  }
  double ratio = std::isfinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  // The cap is on the GPU allocation, so it is checked in pixels, not points.
  if (width * ratio > 8192 || height * ratio > 8192) {
    throw std::runtime_error(
        "tgfx: createOffscreenSurface is capped at 8192 pixels on a side");
  }
  auto surface = std::make_shared<tgfxrn::OffscreenSurface>(
      static_cast<int>(width), static_cast<int>(height), static_cast<float>(pixelRatio),
      opaque, colorSpace == "display-p3");
  return std::make_shared<HybridTgfxOffscreenSurface>(std::move(surface));
}

}  // namespace margelo::nitro::tgfx
