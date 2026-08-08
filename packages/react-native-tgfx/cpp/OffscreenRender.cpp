#include "OffscreenRender.hpp"

#include <cmath>
#include <mutex>
#include <stdexcept>

#include "ImageRegistry.hpp"
#include "TgfxScene.hpp"
#include "tgfx/core/Buffer.h"
#include "tgfx/core/Canvas.h"
#include "tgfx/core/Color.h"
#include "tgfx/core/Data.h"
#include "tgfx/core/Image.h"
#include "tgfx/core/ImageInfo.h"
#include "tgfx/core/Surface.h"
#include "tgfx/gpu/Context.h"
#include "tgfx/gpu/Device.h"

#if defined(__APPLE__)
#include "tgfx/gpu/metal/MetalDevice.h"
#else
#include "tgfx/gpu/opengl/GLDevice.h"
#endif

namespace tgfxrn {
namespace {

std::shared_ptr<tgfx::Device> makeDevice() {
#if defined(__APPLE__)
  return tgfx::MetalDevice::Make();
#else
  return tgfx::GLDevice::Make();
#endif
}

/**
 * A windowless device shared across calls, since creating one costs a GPU
 * context. Context loss is permanent per device, so a lost one is replaced
 * rather than cached as a corpse — the view path gets the same treatment from
 * surface recreation, which this path has no equivalent of.
 *
 * The mutex guards only the pointer. `lockContext` is the real serialisation
 * point, so probing it under this lock would make every caller queue twice.
 */
std::shared_ptr<tgfx::Device> offscreenDevice(bool replace) {
  static std::mutex mutex;
  static std::shared_ptr<tgfx::Device> shared;
  std::lock_guard<std::mutex> guard(mutex);
  if (shared == nullptr || replace) {
    shared = makeDevice();
  }
  return shared;
}

constexpr int kMaxDimension = 8192;

}  // namespace

std::shared_ptr<tgfx::Image> renderSceneOffscreen(std::span<const double> words,
                                                  const std::vector<std::string>& strings,
                                                  int width, int height, float pixelRatio,
                                                  bool opaque, size_t& outBytes) {
  if (width <= 0 || height <= 0) {
    throw std::runtime_error("tgfx: renderToImage needs a width and height above zero");
  }
  float scale = std::isfinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  // In doubles, then range-checked: the int cast is undefined past its range.
  double scaledWidth = static_cast<double>(width) * scale;
  double scaledHeight = static_cast<double>(height) * scale;
  if (scaledWidth > kMaxDimension || scaledHeight > kMaxDimension) {
    throw std::runtime_error("tgfx: renderToImage is capped at 8192 pixels on a side");
  }
  int pixelWidth = static_cast<int>(scaledWidth + 0.5);
  int pixelHeight = static_cast<int>(scaledHeight + 0.5);

  auto device = offscreenDevice(false);
  // A null context means the device lost it for good, so try once with a fresh one.
  auto* context = device == nullptr ? nullptr : device->lockContext();
  if (context == nullptr) {
    device = offscreenDevice(true);
    context = device == nullptr ? nullptr : device->lockContext();
  }
  if (context == nullptr) {
    throw std::runtime_error("tgfx: renderToImage found no GPU to render with");
  }

  // Unlocked on every path out, including the throws below.
  struct Unlock {
    tgfx::Device* device;
    ~Unlock() {
      device->unlock();
    }
  } unlock{device.get()};

  // The whole policy: flushAndSubmit purges down to this, so nothing else has to.
  context->setCacheLimit(ImageRegistry::instance().cacheLimit());

  auto surface = tgfx::Surface::Make(context, pixelWidth, pixelHeight);
  if (surface == nullptr) {
    throw std::runtime_error("tgfx: renderToImage could not allocate a GPU surface");
  }
  auto* canvas = surface->getCanvas();
  canvas->clear(opaque ? tgfx::Color::Black() : tgfx::Color::Transparent());
  canvas->scale(scale, scale);

  SceneRenderer renderer;
  renderer.setScene(words, strings);
  renderer.render(canvas, {});
  context->flushAndSubmit(true);

  auto info = tgfx::ImageInfo::Make(pixelWidth, pixelHeight, tgfx::ColorType::RGBA_8888,
                                    opaque ? tgfx::AlphaType::Opaque : tgfx::AlphaType::Premultiplied);
  tgfx::Buffer buffer(info.byteSize());
  if (buffer.isEmpty() || !surface->readPixels(info, buffer.data())) {
    throw std::runtime_error("tgfx: renderToImage could not read the rendered pixels back");
  }
  outBytes = info.byteSize();
  // CPU pixels, not the surface's texture: the caller draws in a different context.
  return tgfx::Image::MakeFrom(info, buffer.release());
}

}  // namespace tgfxrn
