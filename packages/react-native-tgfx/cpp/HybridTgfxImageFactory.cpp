#include "HybridTgfxImageFactory.hpp"

#include <stdexcept>
#include <utility>

#include "Base64.hpp"
#include "HybridTgfxImage.hpp"
#include "ImageRegistry.hpp"
#include "Log.hpp"
#include "tgfx/core/Data.h"
#include "tgfx/core/Image.h"
#include "tgfx/core/ImageCodec.h"
#include "tgfx/core/YUVColorSpace.h"
#include "tgfx/platform/HardwareBuffer.h"

namespace margelo::nitro::tgfx {

std::shared_ptr<::tgfx::Image> imageFromNativeBuffer(uint64_t buffer, PixelFormat format) {
  if (buffer == 0) {
    return nullptr;
  }
  auto ref = static_cast<::tgfx::HardwareBufferRef>(reinterpret_cast<void*>(buffer));
  if (format == PixelFormat::RGBA) {
    // Single-plane surface: imported as-is, with no YUV conversion.
    return ::tgfx::Image::MakeFrom(ref);
  }
  ::tgfx::YUVColorSpace space = ::tgfx::YUVColorSpace::BT601_LIMITED;
  switch (format) {
    case PixelFormat::BT601_FULL: space = ::tgfx::YUVColorSpace::BT601_FULL; break;
    case PixelFormat::BT709_LIMITED: space = ::tgfx::YUVColorSpace::BT709_LIMITED; break;
    case PixelFormat::BT709_FULL: space = ::tgfx::YUVColorSpace::BT709_FULL; break;
    case PixelFormat::BT2020_LIMITED: space = ::tgfx::YUVColorSpace::BT2020_LIMITED; break;
    case PixelFormat::BT2020_FULL: space = ::tgfx::YUVColorSpace::BT2020_FULL; break;
    case PixelFormat::JPEG_FULL: space = ::tgfx::YUVColorSpace::JPEG_FULL; break;
    default: break;
  }
  return ::tgfx::Image::MakeFrom(ref, space);
}

namespace {

using ImagePromise = Promise<std::shared_ptr<HybridTgfxImageSpec>>;

std::shared_ptr<HybridTgfxImageSpec> registerCodec(
    std::shared_ptr<::tgfx::ImageCodec> codec, const std::string& what) {
  if (codec == nullptr) {
    throw std::runtime_error("tgfx: " + what + " is not a supported image format");
  }
  // Runs on Nitro's thread pool: the decode itself happens inside add().
  auto handle = tgfxrn::ImageRegistry::instance().add(std::move(codec));
  if (handle.handle == 0) {
    throw std::runtime_error("tgfx: failed to decode " + what);
  }
  return std::make_shared<HybridTgfxImage>(handle);
}

/// A `file://` URI names a path; anything else is already one.
std::string stripFileScheme(const std::string& path) {
  constexpr std::string_view kScheme = "file://";
  if (path.rfind(kScheme, 0) == 0) {
    return path.substr(kScheme.size());
  }
  return path;
}

}  // namespace

std::shared_ptr<ImagePromise> HybridTgfxImageFactory::fromFile(const std::string& path) {
  return ImagePromise::async([file = stripFileScheme(path)]() {
    return registerCodec(::tgfx::ImageCodec::MakeFrom(file), file);
  });
}

std::shared_ptr<ImagePromise> HybridTgfxImageFactory::fromBytes(
    const std::shared_ptr<ArrayBuffer>& bytes) {
  // A JS-owned ArrayBuffer is only valid for the duration of this call, so the
  // copy has to happen here rather than on the thread pool.
  auto data = bytes == nullptr || bytes->size() == 0
                  ? nullptr
                  : ::tgfx::Data::MakeWithCopy(bytes->data(), bytes->size());
  return ImagePromise::async([data = std::move(data)]() mutable {
    if (data == nullptr) {
      throw std::runtime_error("tgfx: fromBytes was given an empty buffer");
    }
    return registerCodec(::tgfx::ImageCodec::MakeFrom(std::move(data)), "the given bytes");
  });
}

std::shared_ptr<ImagePromise> HybridTgfxImageFactory::fromBase64(const std::string& input) {
  return ImagePromise::async([input]() {
    auto decoded = tgfxrn::base64Decode(input);
    if (decoded.empty()) {
      throw std::runtime_error("tgfx: fromBase64 was given no decodable bytes");
    }
    auto data = ::tgfx::Data::MakeWithCopy(decoded.data(), decoded.size());
    return registerCodec(::tgfx::ImageCodec::MakeFrom(std::move(data)),
                         "the given base64 payload");
  });
}

std::shared_ptr<HybridTgfxImageSpec> HybridTgfxImageFactory::fromNativeBuffer(
    uint64_t buffer, PixelFormat format) {
  // Synchronous on purpose: there is nothing to decode, and a per-frame camera
  // path cannot spend a promise round trip out of a 16 ms budget.
  auto image = imageFromNativeBuffer(buffer, format);
  if (image == nullptr) {
    throw std::runtime_error("tgfx: the hardware buffer could not be imported");
  }
  auto handle = tgfxrn::ImageRegistry::instance().addExternal(std::move(image));
  return std::make_shared<HybridTgfxImage>(handle);
}

void HybridTgfxImage::setNativeBuffer(uint64_t buffer, PixelFormat format) {
  auto image = imageFromNativeBuffer(buffer, format);
  if (image == nullptr ||
      !tgfxrn::ImageRegistry::instance().replaceExternal(handle_.handle, image)) {
    TGFXRN_LOGW("setNativeBuffer on image %d ignored: not a native-buffer handle",
                handle_.handle);
    return;
  }
  handle_.width = image->width();
  handle_.height = image->height();
}

void HybridTgfxImageFactory::setCacheLimit(double bytes) {
  tgfxrn::ImageRegistry::instance().setCacheLimit(
      bytes > 0 ? static_cast<size_t>(bytes) : 0);
}

double HybridTgfxImageFactory::getCachedBytes() {
  return static_cast<double>(tgfxrn::ImageRegistry::instance().cachedBytes());
}

}  // namespace margelo::nitro::tgfx
