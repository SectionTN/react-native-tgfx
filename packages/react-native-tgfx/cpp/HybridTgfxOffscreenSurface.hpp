// The Nitro shell over OffscreenSurface: argument plumbing only, engine in cpp/OffscreenSurface.cpp.
#pragma once

#include <memory>

#include "HybridTgfxOffscreenSurfaceFactorySpec.hpp"
#include "HybridTgfxOffscreenSurfaceSpec.hpp"
#include "OffscreenSurface.hpp"

namespace margelo::nitro::tgfx {

class HybridTgfxOffscreenSurface : public HybridTgfxOffscreenSurfaceSpec {
 public:
  explicit HybridTgfxOffscreenSurface(std::shared_ptr<tgfxrn::OffscreenSurface> surface)
      : HybridObject(TAG), surface_(std::move(surface)) {}

  ~HybridTgfxOffscreenSurface() override {
    dispose();
  }

  double getWidth() override {
    return surface_->width();
  }
  double getHeight() override {
    return surface_->height();
  }

  void setScene(const std::shared_ptr<ArrayBuffer>& scene,
                const std::vector<std::string>& strings) override;
  void setValues(const std::vector<double>& values) override;
  void setStringValues(const std::vector<double>& indices,
                       const std::vector<std::string>& values) override;
  void setViewport(const std::vector<double>& viewport) override;
  std::vector<double> hitTest(double x, double y, bool precise) override;
  void flush() override;
  std::shared_ptr<Promise<std::shared_ptr<HybridTgfxImageSpec>>> toImage() override;
  std::shared_ptr<Promise<void>> save(const std::string& path,
                                      const std::optional<std::string>& format,
                                      std::optional<double> quality) override;

  void dispose() override {
    surface_->dispose();
  }

 private:
  std::shared_ptr<tgfxrn::OffscreenSurface> surface_;
};

class HybridTgfxOffscreenSurfaceFactory : public HybridTgfxOffscreenSurfaceFactorySpec {
 public:
  HybridTgfxOffscreenSurfaceFactory() : HybridObject(TAG) {}

  std::shared_ptr<HybridTgfxOffscreenSurfaceSpec> create(double width, double height,
                                                         double pixelRatio, bool opaque,
                                                         const std::string& colorSpace) override;
};

}  // namespace margelo::nitro::tgfx
