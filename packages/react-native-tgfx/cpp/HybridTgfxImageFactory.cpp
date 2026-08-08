#include "HybridTgfxImageFactory.hpp"

#include <cmath>
#include <stdexcept>
#include <utility>

#include "Base64.hpp"
#include "HybridTgfxImage.hpp"
#include "ImageRegistry.hpp"
#include "OffscreenRender.hpp"
#include "Log.hpp"
#include "SvgImage.hpp"
#include "TgfxFrameSink.hpp"
#include "tgfx/core/Data.h"
#include "tgfx/core/Image.h"
#include "tgfx/core/ImageCodec.h"

namespace margelo::nitro::tgfx {

/// Exhaustive with no `default:`, so -Wswitch names the omission when nitrogen adds a value.
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
  auto handle = tgfxrn::ImageRegistry::instance().add(std::move(codec));
  if (handle.handle == 0) {
    throw std::runtime_error("tgfx: failed to decode " + what);
  }
  return std::make_shared<HybridTgfxImage>(handle);
}

/// Every byte-shaped entry point lands here, so an `.svg` works wherever a PNG does.
std::shared_ptr<HybridTgfxImageSpec> registerData(std::shared_ptr<::tgfx::Data> data,
                                                  const std::string& what) {
  if (data == nullptr || data->empty()) {
    throw std::runtime_error("tgfx: " + what + " is not a supported image format");
  }
  if (!tgfxrn::looksLikeSvg(*data)) {
    return registerCodec(::tgfx::ImageCodec::MakeFrom(std::move(data)), what);
  }
  auto image = tgfxrn::svgImage(data);
  if (image == nullptr) {
    throw std::runtime_error("tgfx: " + what + " is not a renderable SVG document");
  }
  // External: there are no decoded pixels to budget, and the picture replays at whatever
  // size it is drawn, so the handle's own size is nominal rather than a resolution cap.
  auto handle = tgfxrn::ImageRegistry::instance().addExternal(std::move(image));
  if (handle.handle == 0) {
    throw std::runtime_error("tgfx: failed to render " + what);
  }
  return std::make_shared<HybridTgfxImage>(handle);
}

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
    // Codec first: it keeps the bytes on disk and re-reads them after an eviction, which
    // reading the file up front would give up. Only a non-raster falls through to the bytes.
    if (auto codec = ::tgfx::ImageCodec::MakeFrom(file)) {
      return registerCodec(std::move(codec), file);
    }
    return registerData(::tgfx::Data::MakeFromFile(file), file);
  });
}

std::shared_ptr<ImagePromise> HybridTgfxImageFactory::fromBytes(
    const std::shared_ptr<ArrayBuffer>& bytes) {
  // A JS-owned ArrayBuffer is only valid for this call, so the copy cannot go to the pool.
  auto data = bytes == nullptr || bytes->size() == 0
                  ? nullptr
                  : ::tgfx::Data::MakeWithCopy(bytes->data(), bytes->size());
  return ImagePromise::async([data = std::move(data)]() mutable {
    if (data == nullptr) {
      throw std::runtime_error("tgfx: fromBytes was given an empty buffer");
    }
    return registerData(std::move(data), "the given bytes");
  });
}

std::shared_ptr<ImagePromise> HybridTgfxImageFactory::fromBase64(const std::string& input) {
  return ImagePromise::async([input]() {
    auto decoded = tgfxrn::base64Decode(input);
    if (decoded.empty()) {
      throw std::runtime_error("tgfx: fromBase64 was given no decodable bytes");
    }
    auto data = ::tgfx::Data::MakeWithCopy(decoded.data(), decoded.size());
    return registerData(std::move(data), "the given base64 payload");
  });
}

std::shared_ptr<ImagePromise> HybridTgfxImageFactory::fromScene(
    const std::shared_ptr<ArrayBuffer>& words, const std::vector<std::string>& strings,
    double width, double height, double pixelRatio, bool opaque) {
  // Copied here, not on the worker: a JS-owned ArrayBuffer is only valid for this call.
  std::vector<double> program;
  if (words != nullptr && words->size() >= sizeof(double)) {
    const auto* data = reinterpret_cast<const double*>(words->data());
    program.assign(data, data + words->size() / sizeof(double));
  }
  if (program.empty()) {
    throw std::runtime_error("tgfx: renderToImage was given an empty draw program");
  }
  if (!std::isfinite(width) || !std::isfinite(height) || !std::isfinite(pixelRatio) ||
      width <= 0 || height <= 0 || width > 65536 || height > 65536) {
    throw std::runtime_error("tgfx: renderToImage needs a finite width and height above zero");
  }
  return ImagePromise::async([program = std::move(program), strings, width, height, pixelRatio,
                              opaque]() {
    size_t bytes = 0;
    auto image = tgfxrn::renderSceneOffscreen(program, strings, static_cast<int>(width),
                                              static_cast<int>(height),
                                              static_cast<float>(pixelRatio), opaque, bytes);
    if (image == nullptr) {
      throw std::runtime_error("tgfx: renderToImage produced no image");
    }
    // External so it is never evicted, but its bytes are ours and the GC is told.
    auto handle = tgfxrn::ImageRegistry::instance().addExternal(std::move(image), bytes);
    if (handle.handle == 0) {
      throw std::runtime_error("tgfx: renderToImage could not register the result");
    }
    return std::static_pointer_cast<HybridTgfxImageSpec>(std::make_shared<HybridTgfxImage>(handle));
  });
}

std::shared_ptr<HybridTgfxImageSpec> HybridTgfxImageFactory::fromNativeBuffer(
    uint64_t buffer, PixelFormat format) {
  // Synchronous: nothing to decode, and a per-frame path cannot spend a promise round trip.
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
