// Pixel readback for a TgfxRenderer: the request the platform layer stages, and
// the CPU-side tail (alpha conversion, encode, optional file write) that runs on
// a worker so it never touches the render thread — which on Android is shared by
// every canvas in the process.
#pragma once

#include <cstdint>
#include <fstream>
#include <functional>
#include <memory>
#include <string>
#include <vector>

#include "tgfx/core/Data.h"
#include "tgfx/core/EncodedFormat.h"
#include "tgfx/core/ImageCodec.h"
#include "tgfx/core/ImageInfo.h"
#include "tgfx/core/Pixmap.h"
#include "tgfx/core/Rect.h"

namespace tgfxrn {

struct SnapshotRequest {
  /// "png" | "jpeg" | "webp" | "raw"; anything else is treated as "png".
  std::string format = "png";
  int quality = 100;
  /// Crop in logical pixels (dp), matching scene coordinates. A width or height
  /// of zero means the whole canvas.
  float x = 0;
  float y = 0;
  float width = 0;
  float height = 0;
  /// Multiplier on the cropped region's physical-pixel size.
  float scale = 1;
  /// Non-empty: encode and write here instead of handing the bytes back.
  std::string path;
};

/// `error` empty means success. `data` is null for a request with a `path`.
///
/// Never called on the render thread. Anything the renderer accepted — every
/// success, and every failure raised once the request reached the GPU — arrives
/// on a tgfx::Task worker. A request the platform layer rejects before it gets
/// that far (an unmounted canvas) is answered inline on the requesting thread:
/// the JS thread on Android, the main thread on iOS.
using SnapshotCallback = std::function<void(std::shared_ptr<tgfx::Data> data,
                                            int width, int height,
                                            const std::string& error)>;

/// The device-pixel rect a request reads, clamped to `bounds` (the surface, also
/// in device pixels). Empty means the crop lies outside the canvas.
///
/// Rounded, not truncated: Surface::asyncReadPixels casts the rect straight to
/// size_t, so a fractional device rect would silently shrink and the size the
/// promise resolves with would not be the size that was asked for.
inline tgfx::Rect snapshotSourceRect(const SnapshotRequest& request, float ratio,
                                     const tgfx::Rect& bounds) {
  if (request.width <= 0 || request.height <= 0) {
    return bounds;
  }
  auto source = tgfx::Rect::MakeXYWH(request.x * ratio, request.y * ratio,
                                     request.width * ratio, request.height * ratio);
  source.round();
  if (!source.intersect(bounds)) {
    return tgfx::Rect::MakeEmpty();
  }
  return source;
}

inline tgfx::EncodedFormat encodedFormat(const std::string& format) {
  if (format == "jpeg" || format == "jpg") {
    return tgfx::EncodedFormat::JPEG;
  }
  if (format == "webp") {
    return tgfx::EncodedFormat::WEBP;
  }
  return tgfx::EncodedFormat::PNG;
}

/// Convert, encode and deliver a readback. `pixels` is whatever the GPU handed
/// back (premultiplied, possibly row-padded); everything below normalises it to
/// tightly packed straight-alpha RGBA8888 first, so the documented output does
/// not depend on the backend.
inline void finishSnapshot(std::shared_ptr<tgfx::Data> pixels,
                           const tgfx::ImageInfo& info,
                           const SnapshotRequest& request,
                           const SnapshotCallback& callback) {
  auto fail = [&](const std::string& error) { callback(nullptr, 0, 0, error); };
  if (pixels == nullptr || info.isEmpty()) {
    fail("[tgfx] snapshot: the readback returned no pixels");
    return;
  }
  auto dstInfo = tgfx::ImageInfo::Make(info.width(), info.height(),
                                       tgfx::ColorType::RGBA_8888,
                                       tgfx::AlphaType::Unpremultiplied);
  std::vector<uint8_t> straight(dstInfo.byteSize());
  tgfx::Pixmap src(info, pixels->data());
  if (!src.readPixels(dstInfo, straight.data())) {
    fail("[tgfx] snapshot: could not convert the readback to straight-alpha RGBA");
    return;
  }
  pixels = nullptr;

  std::shared_ptr<tgfx::Data> out;
  if (request.format == "raw") {
    out = tgfx::Data::MakeWithCopy(straight.data(), straight.size());
  } else {
    tgfx::Pixmap pixmap(dstInfo, straight.data());
    out = tgfx::ImageCodec::Encode(pixmap, encodedFormat(request.format),
                                   request.quality);
  }
  if (out == nullptr) {
    fail("[tgfx] snapshot: encoding to '" + request.format + "' failed");
    return;
  }
  if (request.path.empty()) {
    callback(std::move(out), dstInfo.width(), dstInfo.height(), "");
    return;
  }
  // save(): the bytes are written here and never handed back, so they never
  // reach JS at all.
  std::ofstream file(request.path, std::ios::binary | std::ios::trunc);
  file.write(static_cast<const char*>(out->data()),
             static_cast<std::streamsize>(out->size()));
  file.close();
  if (!file) {
    fail("[tgfx] save: could not write '" + request.path + "'");
    return;
  }
  callback(nullptr, dstInfo.width(), dstInfo.height(), "");
}

}  // namespace tgfxrn
