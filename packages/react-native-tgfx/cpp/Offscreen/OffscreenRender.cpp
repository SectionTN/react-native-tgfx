#include "OffscreenRender.hpp"

#include <chrono>
#include <cmath>
#include <mutex>
#include <stdexcept>

#include "ImageRegistry.hpp"
#include "TgfxScene.hpp"
#include "tgfx/core/Buffer.h"
#include "tgfx/core/Canvas.h"
#include "tgfx/core/Color.h"
#include "tgfx/core/ColorSpace.h"
#include "tgfx/core/Data.h"
#include "tgfx/core/Image.h"
#include "tgfx/core/ImageInfo.h"
#include "tgfx/core/Surface.h"
#include "tgfx/gpu/Context.h"
#include "tgfx/gpu/Device.h"

#if defined(__APPLE__)
#include "tgfx/gpu/metal/MetalDevice.h"
#elif defined(TGFX_RN_VULKAN)
#include "tgfx/gpu/vulkan/VulkanDevice.h"
#else
#include "tgfx/gpu/opengl/GLDevice.h"
#endif

namespace tgfxrn {
namespace {

std::shared_ptr<tgfx::Device> makeDevice() {
#if defined(__APPLE__)
  return tgfx::MetalDevice::Make();
#elif defined(TGFX_RN_VULKAN)
  return tgfx::VulkanDevice::Make();
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
std::mutex offscreenDeviceMutex;
std::shared_ptr<tgfx::Device> offscreenDeviceShared;

std::shared_ptr<tgfx::Device> offscreenDevice(bool replace) {
  std::lock_guard<std::mutex> guard(offscreenDeviceMutex);
  if (offscreenDeviceShared == nullptr || replace) {
    offscreenDeviceShared = makeDevice();
  }
  return offscreenDeviceShared;
}

/// The shared device if one was ever made — a cache probe must not create a GPU context.
std::shared_ptr<tgfx::Device> peekOffscreenDevice() {
  std::lock_guard<std::mutex> guard(offscreenDeviceMutex);
  return offscreenDeviceShared;
}

constexpr int kMaxDimension = 8192;

}  // namespace

size_t offscreenGpuBytes() {
  auto device = peekOffscreenDevice();
  auto* context = device == nullptr ? nullptr : device->lockContext();
  if (context == nullptr) {
    return 0;
  }
  size_t bytes = context->memoryUsage();
  device->unlock();
  return bytes;
}

void purgeOffscreenGpu() {
  auto device = peekOffscreenDevice();
  auto* context = device == nullptr ? nullptr : device->lockContext();
  if (context == nullptr) {
    return;
  }
  context->purgeResourcesNotUsedSince(std::chrono::steady_clock::now());
  device->unlock();
}

OffscreenContext::OffscreenContext() {
  device_ = offscreenDevice(false);
  context_ = device_ == nullptr ? nullptr : device_->lockContext();
  if (context_ == nullptr) {
    // A null context means the device lost it for good, so try once with a fresh one.
    device_ = offscreenDevice(true);
    context_ = device_ == nullptr ? nullptr : device_->lockContext();
  }
  if (context_ == nullptr) {
    throw std::runtime_error("tgfx: found no GPU to render with");
  }
  // The whole policy: flushAndSubmit purges down to this, so nothing else has to.
  context_->setCacheLimit(ImageRegistry::instance().cacheLimit());
}

OffscreenContext::~OffscreenContext() {
  if (context_ != nullptr) {
    device_->unlock();
  }
}

std::shared_ptr<tgfx::Image> renderSceneOffscreen(std::span<const double> words,
                                                  const std::vector<std::string>& strings,
                                                  int width, int height, float pixelRatio,
                                                  bool opaque, bool displayP3, size_t& outBytes) {
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

  OffscreenContext locked;
  auto* context = locked.get();

  auto space = displayP3 ? tgfx::ColorSpace::DisplayP3() : tgfx::ColorSpace::SRGB();
  auto surface =
      tgfx::Surface::Make(context, pixelWidth, pixelHeight, false, 1, false, 0, space);
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

  // Tagged with the surface's space: these pixels outlive this context, and an
  // untagged image is taken for whatever space it is later drawn into.
  auto info = tgfx::ImageInfo::Make(pixelWidth, pixelHeight, tgfx::ColorType::RGBA_8888,
                                    opaque ? tgfx::AlphaType::Opaque : tgfx::AlphaType::Premultiplied,
                                    0, space);
  tgfx::Buffer buffer(info.byteSize());
  if (buffer.isEmpty() || !surface->readPixels(info, buffer.data())) {
    throw std::runtime_error("tgfx: renderToImage could not read the rendered pixels back");
  }
  outBytes = info.byteSize();
  // CPU pixels, not the surface's texture: the caller draws in a different context.
  return tgfx::Image::MakeFrom(info, buffer.release());
}

RasterizedImage rasterizeRegisteredImage(int32_t handle) {
  auto image = ImageRegistry::instance().sourceImage(handle);
  if (image == nullptr) {
    throw std::runtime_error(
        "tgfx: this image is disposed, or is a live per-frame image (camera, video, fromPixels), "
        "which cannot be encoded");
  }
  int width = image->width();
  int height = image->height();
  if (width <= 0 || height <= 0) {
    throw std::runtime_error("tgfx: this image has no pixels to encode");
  }
  if (width > kMaxDimension || height > kMaxDimension) {
    throw std::runtime_error("tgfx: encode is capped at 8192 pixels on a side");
  }

  OffscreenContext locked;
  auto* context = locked.get();
  // The source's own space, carried through: an untagged surface would pass P3
  // numbers through unconverted and the encode tail would then label them sRGB.
  auto space = image->colorSpace();
  auto surface = tgfx::Surface::Make(context, width, height, false, 1, false, 0, space);
  if (surface == nullptr) {
    throw std::runtime_error("tgfx: encode could not allocate a GPU surface");
  }
  auto* canvas = surface->getCanvas();
  canvas->clear(tgfx::Color::Transparent());
  canvas->drawImage(image, 0, 0);
  context->flushAndSubmit(true);

  auto info = tgfx::ImageInfo::Make(width, height, tgfx::ColorType::RGBA_8888,
                                    tgfx::AlphaType::Premultiplied, 0, space);
  tgfx::Buffer buffer(info.byteSize());
  if (buffer.isEmpty() || !surface->readPixels(info, buffer.data())) {
    throw std::runtime_error("tgfx: encode could not read the rasterized pixels back");
  }
  return {buffer.release(), info};
}

}  // namespace tgfxrn
