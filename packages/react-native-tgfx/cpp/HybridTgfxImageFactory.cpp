#include "HybridTgfxImageFactory.hpp"

#include <stdexcept>
#include <utility>

#include "Base64.hpp"
#include "HybridTgfxImage.hpp"
#include "ImageRegistry.hpp"
#include "Log.hpp"
#include "TgfxFrameSink.hpp"
#include "tgfx/core/Data.h"
#include "tgfx/core/Image.h"
#include "tgfx/core/ImageCodec.h"

namespace margelo::nitro::tgfx {

/// The JS-facing `PixelFormat` to the exported `FrameFormat`.
///
/// Deliberately exhaustive with no `default:`, so `-Wswitch` names the omission
/// when nitrogen adds a value to the union (verified: removing a case prints
/// "enumeration value 'JPEG_FULL' not handled in switch"). A `default:` here
/// would map a new colour space to BT.601 limited and say nothing — and getting
/// the *range* silently wrong is precisely the bug class this file has had
/// before: an image still appears, just with crushed blacks.
tgfxrn::FrameFormat toFrameFormat(PixelFormat format) {
  switch (format) {
    case PixelFormat::RGBA: return tgfxrn::FrameFormat::RGBA;
    case PixelFormat::BT601_LIMITED: return tgfxrn::FrameFormat::BT601Limited;
    case PixelFormat::BT601_FULL: return tgfxrn::FrameFormat::BT601Full;
    case PixelFormat::BT709_LIMITED: return tgfxrn::FrameFormat::BT709Limited;
    case PixelFormat::BT709_FULL: return tgfxrn::FrameFormat::BT709Full;
    case PixelFormat::BT2020_LIMITED: return tgfxrn::FrameFormat::BT2020Limited;
    case PixelFormat::BT2020_FULL: return tgfxrn::FrameFormat::BT2020Full;
    case PixelFormat::JPEG_FULL: return tgfxrn::FrameFormat::JPEGFull;
  }
  // Only reachable from an out-of-range cast, which JSIConverter rejects first.
  return tgfxrn::FrameFormat::BT601Limited;
}

std::shared_ptr<::tgfx::Image> imageFromNativeBuffer(uint64_t buffer, PixelFormat format) {
  return tgfxrn::importHardwareBuffer(buffer, toFrameFormat(format));
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
