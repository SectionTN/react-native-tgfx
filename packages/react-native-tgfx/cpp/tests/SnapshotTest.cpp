// Host test for the readback tail in cpp/Snapshot.hpp: the async GPU→CPU copy,
// the straight-alpha conversion, the encode, and the native file write that
// backs Canvas.save().
//
// Every assertion is gated on real drawn pixels — the source frame is checked
// for the colour that was actually drawn before anything is encoded, so a
// silently blank surface fails instead of passing an all-zero round trip.
//
// Build and run: see cpp/tests/CMakeLists.txt.
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>

#include "Snapshot.hpp"
#include "tgfx/core/Canvas.h"
#include "tgfx/core/Color.h"
#include "tgfx/core/Image.h"
#include "tgfx/core/ImageCodec.h"
#include "tgfx/core/Paint.h"
#include "tgfx/core/Rect.h"
#include "tgfx/core/Surface.h"
#include "tgfx/core/SurfaceReadback.h"
#include "tgfx/gpu/Device.h"
#include "tgfx/gpu/metal/MetalDevice.h"

namespace {

int failures = 0;

#define CHECK(cond)                                                 \
  do {                                                              \
    if (!(cond)) {                                                  \
      std::printf("  FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond); \
      failures++;                                                   \
    }                                                               \
  } while (0)

constexpr int kWidth = 64;
constexpr int kHeight = 48;
// Half-transparent, so a premultiplied readback that skipped the straight-alpha
// conversion would come back visibly darker.
constexpr uint8_t kR = 200;
constexpr uint8_t kG = 60;
constexpr uint8_t kB = 30;
constexpr uint8_t kA = 128;

tgfx::Device* device() {
  static auto shared = tgfx::MetalDevice::Make();
  return shared.get();
}

/// One filled rect covering the left half of the surface.
std::shared_ptr<tgfx::Surface> drawFrame(tgfx::Context* context) {
  auto surface = tgfx::Surface::Make(context, kWidth, kHeight);
  auto* canvas = surface->getCanvas();
  canvas->clear();
  tgfx::Paint paint;
  paint.setColor(tgfx::Color::FromRGBA(kR, kG, kB, kA));
  canvas->drawRect(tgfx::Rect::MakeWH(kWidth / 2, kHeight), paint);
  return surface;
}

/// The renderer's collect step, minus the display link: issue the readback,
/// let the GPU finish, then copy it out exactly as TgfxRenderer does.
std::shared_ptr<tgfx::Data> readBack(tgfx::Context* context,
                                     const std::shared_ptr<tgfx::Surface>& surface,
                                     tgfx::ImageInfo* info) {
  auto readback = surface->asyncReadPixels(
      tgfx::Rect::MakeWH(surface->width(), surface->height()));
  if (readback == nullptr) {
    return nullptr;
  }
  context->flushAndSubmit(true);
  CHECK(readback->isReady(context));
  *info = readback->info();
  const void* pixels =
      readback->lockPixels(context, surface->origin() == tgfx::ImageOrigin::BottomLeft);
  auto copy = pixels != nullptr ? tgfx::Data::MakeWithCopy(pixels, info->byteSize())
                                : nullptr;
  readback->unlockPixels(context);
  return copy;
}

/// Decode `bytes` and return them as tightly packed straight-alpha RGBA.
std::vector<uint8_t> decode(const std::shared_ptr<tgfx::Data>& bytes, int* width,
                            int* height) {
  auto codec = tgfx::ImageCodec::MakeFrom(bytes);
  if (codec == nullptr) {
    return {};
  }
  *width = codec->width();
  *height = codec->height();
  auto info = tgfx::ImageInfo::Make(codec->width(), codec->height(),
                                    tgfx::ColorType::RGBA_8888,
                                    tgfx::AlphaType::Unpremultiplied);
  std::vector<uint8_t> pixels(info.byteSize());
  if (!codec->readPixels(info, pixels.data())) {
    return {};
  }
  return pixels;
}

/// True when `pixels` holds the drawn colour on the left and nothing on the
/// right — the gate that makes every assertion below about a real frame.
bool looksLikeTheFrame(const std::vector<uint8_t>& pixels, int width, int height,
                       int tolerance) {
  if (pixels.size() != static_cast<size_t>(width) * height * 4) {
    return false;
  }
  auto at = [&](int x, int y, int channel) {
    return static_cast<int>(pixels[(static_cast<size_t>(y) * width + x) * 4 + channel]);
  };
  auto near = [&](int value, int expected) {
    return value >= expected - tolerance && value <= expected + tolerance;
  };
  int insideX = width / 4;
  int outsideX = width - width / 4;
  int y = height / 2;
  return near(at(insideX, y, 0), kR) && near(at(insideX, y, 1), kG) &&
         near(at(insideX, y, 2), kB) && near(at(insideX, y, 3), kA) &&
         at(outsideX, y, 3) == 0;
}

void snapshotRoundTripsThroughPng() {
  auto* context = device()->lockContext();
  auto surface = drawFrame(context);
  tgfx::ImageInfo info;
  auto pixels = readBack(context, surface, &info);
  device()->unlock();
  CHECK(pixels != nullptr);
  if (pixels == nullptr) {
    return;
  }

  // Gate: the raw readback really carries the drawn colour, at straight alpha.
  tgfxrn::SnapshotRequest rawRequest;
  rawRequest.format = "raw";
  std::shared_ptr<tgfx::Data> raw;
  int rawWidth = 0;
  int rawHeight = 0;
  tgfxrn::finishSnapshot(pixels, info, rawRequest,
                         [&](std::shared_ptr<tgfx::Data> data, int w, int h,
                             const std::string& error) {
                           CHECK(error.empty());
                           raw = std::move(data);
                           rawWidth = w;
                           rawHeight = h;
                         });
  CHECK(rawWidth == kWidth);
  CHECK(rawHeight == kHeight);
  CHECK(raw != nullptr);
  if (raw == nullptr) {
    return;
  }
  std::vector<uint8_t> rawPixels(static_cast<const uint8_t*>(raw->data()),
                                 static_cast<const uint8_t*>(raw->data()) + raw->size());
  CHECK(looksLikeTheFrame(rawPixels, kWidth, kHeight, 2));

  // PNG is lossless, so it must decode back to the very same frame.
  tgfxrn::SnapshotRequest pngRequest;
  std::shared_ptr<tgfx::Data> png;
  tgfxrn::finishSnapshot(pixels, info, pngRequest,
                         [&](std::shared_ptr<tgfx::Data> data, int, int,
                             const std::string& error) {
                           CHECK(error.empty());
                           png = std::move(data);
                         });
  CHECK(png != nullptr);
  if (png == nullptr) {
    return;
  }
  int width = 0;
  int height = 0;
  auto decoded = decode(png, &width, &height);
  CHECK(width == kWidth);
  CHECK(height == kHeight);
  CHECK(looksLikeTheFrame(decoded, width, height, 2));
}

void saveWritesADecodableFile() {
  auto* context = device()->lockContext();
  auto surface = drawFrame(context);
  tgfx::ImageInfo info;
  auto pixels = readBack(context, surface, &info);
  device()->unlock();
  CHECK(pixels != nullptr);
  if (pixels == nullptr) {
    return;
  }
  tgfxrn::SnapshotRequest request;
  request.path = std::string(std::tmpnam(nullptr)) + ".png";
  std::shared_ptr<tgfx::Data> handedBack = nullptr;
  tgfxrn::finishSnapshot(pixels, info, request,
                         [&](std::shared_ptr<tgfx::Data> data, int, int,
                             const std::string& error) {
                           CHECK(error.empty());
                           handedBack = std::move(data);
                         });
  // save() must not hand the bytes back: that is the whole reason it exists.
  CHECK(handedBack == nullptr);

  auto onDisk = tgfx::Data::MakeFromFile(request.path);
  CHECK(onDisk != nullptr);
  if (onDisk == nullptr) {
    return;
  }
  int width = 0;
  int height = 0;
  auto decoded = decode(onDisk, &width, &height);
  CHECK(width == kWidth);
  CHECK(height == kHeight);
  CHECK(looksLikeTheFrame(decoded, width, height, 2));
  std::remove(request.path.c_str());
}

void badRequestsReportInsteadOfProducingABlankImage() {
  tgfx::ImageInfo info;
  std::string error;
  tgfxrn::finishSnapshot(nullptr, info, {},
                         [&](std::shared_ptr<tgfx::Data>, int, int,
                             const std::string& message) { error = message; });
  CHECK(!error.empty());

  auto* context = device()->lockContext();
  auto surface = drawFrame(context);
  auto pixels = readBack(context, surface, &info);
  device()->unlock();
  tgfxrn::SnapshotRequest request;
  request.path = "/definitely/not/a/directory/out.png";
  error.clear();
  tgfxrn::finishSnapshot(pixels, info, request,
                         [&](std::shared_ptr<tgfx::Data>, int, int,
                             const std::string& message) { error = message; });
  CHECK(error.find("save") != std::string::npos);
}

/// The `rect` half of a request, in isolation: snapshotSourceRect is what turns a
/// logical-pixel crop into the device rect handed to Surface::asyncReadPixels.
void fractionalRectsRoundInsteadOfTruncating() {
  auto bounds = tgfx::Rect::MakeWH(kWidth, kHeight);
  CHECK(tgfxrn::snapshotSourceRect({}, 2.0f, bounds) == bounds);

  tgfxrn::SnapshotRequest request;
  request.x = 4.2f;
  request.y = 3.1f;
  request.width = 12.4f;
  request.height = 9.3f;
  // Device rect (8.4, 6.2)–(33.2, 24.8). asyncReadPixels casts to size_t, so
  // unrounded this would read 24×18 and resolve the promise with those numbers.
  auto source = tgfxrn::snapshotSourceRect(request, 2.0f, bounds);
  CHECK(source == tgfx::Rect::MakeLTRB(8, 6, 33, 25));
  CHECK(source.width() == std::round(source.width()));
  CHECK(source.height() == std::round(source.height()));

  tgfxrn::SnapshotRequest clipped;
  clipped.x = 24;
  clipped.y = 0;
  clipped.width = 40;
  clipped.height = 10;
  // Past the right edge at ratio 2: clamped, not read out of bounds.
  CHECK(tgfxrn::snapshotSourceRect(clipped, 2.0f, bounds) ==
        tgfx::Rect::MakeLTRB(48, 0, 64, 20));

  tgfxrn::SnapshotRequest outside;
  outside.x = 200;
  outside.y = 0;
  outside.width = 10;
  outside.height = 10;
  CHECK(tgfxrn::snapshotSourceRect(outside, 2.0f, bounds).isEmpty());
  // Sub-pixel crops round away to nothing rather than reading a zero-sized rect.
  tgfxrn::SnapshotRequest sliver;
  sliver.x = 1;
  sliver.y = 1;
  sliver.width = 0.2f;
  sliver.height = 0.2f;
  CHECK(tgfxrn::snapshotSourceRect(sliver, 1.0f, bounds).isEmpty());
}

/// `rect` + `scale` end to end, mirroring TgfxRenderer::startSnapshots' scaled
/// path: crop in device pixels, blit into a scratch surface at `scale`, read
/// that back. The crop is deliberately off-centre and asymmetric, so ignoring
/// either the offset or the scale moves the drawn colour off its expected pixel.
void cropAndScaleLandWhereTheyWereAsked() {
  auto* context = device()->lockContext();
  auto surface = drawFrame(context);
  auto bounds = tgfx::Rect::MakeWH(kWidth, kHeight);

  tgfxrn::SnapshotRequest request;
  request.format = "raw";
  request.x = 8;
  request.y = 0;
  request.width = 24;
  request.height = 24;
  request.scale = 1.5f;
  // Ratio 2 → device rect (16, 0)–(64, 48): the colour fills device x 0–32, so
  // exactly its right third lands in the crop, at the crop's left edge.
  auto source = tgfxrn::snapshotSourceRect(request, 2.0f, bounds);
  CHECK(source == tgfx::Rect::MakeLTRB(16, 0, 64, 48));

  int width = static_cast<int>(std::lround(source.width() * request.scale));
  int height = static_cast<int>(std::lround(source.height() * request.scale));
  CHECK(width == 72);
  CHECK(height == 72);
  auto scratch = tgfx::Surface::Make(context, width, height);
  auto image = surface->makeImageSnapshot();
  CHECK(scratch != nullptr);
  CHECK(image != nullptr);
  if (scratch == nullptr || image == nullptr) {
    device()->unlock();
    return;
  }
  auto* canvas = scratch->getCanvas();
  canvas->clear();
  canvas->scale(request.scale, request.scale);
  canvas->translate(-source.x(), -source.y());
  canvas->drawImage(image);

  tgfx::ImageInfo info;
  auto pixels = readBack(context, scratch, &info);
  device()->unlock();
  CHECK(pixels != nullptr);
  if (pixels == nullptr) {
    return;
  }

  std::shared_ptr<tgfx::Data> raw;
  int outWidth = 0;
  int outHeight = 0;
  tgfxrn::finishSnapshot(pixels, info, request,
                         [&](std::shared_ptr<tgfx::Data> data, int w, int h,
                             const std::string& error) {
                           CHECK(error.empty());
                           raw = std::move(data);
                           outWidth = w;
                           outHeight = h;
                         });
  CHECK(outWidth == 72);
  CHECK(outHeight == 72);
  CHECK(raw != nullptr);
  if (raw == nullptr) {
    return;
  }
  std::vector<uint8_t> out(static_cast<const uint8_t*>(raw->data()),
                           static_cast<const uint8_t*>(raw->data()) + raw->size());
  CHECK(out.size() == static_cast<size_t>(outWidth) * outHeight * 4);
  auto at = [&](int x, int y, int channel) {
    return static_cast<int>(out[(static_cast<size_t>(y) * outWidth + x) * 4 + channel]);
  };
  auto near = [](int value, int expected) {
    return value >= expected - 2 && value <= expected + 2;
  };
  // Device x 16–32 → crop x 0–16 → scaled x 0–24. Everything right of that was
  // transparent canvas.
  int y = outHeight / 2;
  CHECK(near(at(8, y, 0), kR));
  CHECK(near(at(8, y, 1), kG));
  CHECK(near(at(8, y, 2), kB));
  CHECK(near(at(8, y, 3), kA));
  // Ignore the crop offset and the whole frame is scaled instead: colour would
  // run to x = 48 and this would not be transparent.
  CHECK(at(30, y, 3) == 0);
  CHECK(at(60, y, 3) == 0);
  // Ignore the scale and the colour stops at x = 16, so this would be.
  CHECK(near(at(20, y, 3), kA));
}

}  // namespace

int main() {
  std::printf("snapshotRoundTripsThroughPng\n");
  snapshotRoundTripsThroughPng();
  std::printf("saveWritesADecodableFile\n");
  saveWritesADecodableFile();
  std::printf("badRequestsReportInsteadOfProducingABlankImage\n");
  badRequestsReportInsteadOfProducingABlankImage();
  std::printf("fractionalRectsRoundInsteadOfTruncating\n");
  fractionalRectsRoundInsteadOfTruncating();
  std::printf("cropAndScaleLandWhereTheyWereAsked\n");
  cropAndScaleLandWhereTheyWereAsked();
  std::printf(failures == 0 ? "PASS\n" : "FAILED (%d)\n", failures);
  return failures == 0 ? 0 : 1;
}
