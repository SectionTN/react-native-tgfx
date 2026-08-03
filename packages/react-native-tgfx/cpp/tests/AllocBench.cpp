// How many heap allocations one frame costs, with and without filters, on an
// animated scene — one where the paint really is resolved per frame, so
// applyPaint runs once per node per frame.
//
// Replaces global operator new, so allocations inside the draw are counted,
// tgfx's own included — but not the over-aligned operator new, which reaches
// aligned_alloc directly. The numbers are a floor, not a total; both sides use
// the same instrument, so the A/B still holds. The claim it exists to support
// is that a filter costs nothing per frame: it is built once at setScene and
// only applied afterwards.
//
// The second half measures <Text>: the memoised layout against the
// drawSimpleText path it replaces, reported as a mean rather than a best-of-N
// because the interesting case is a size that keeps crossing a quantum.
//
// Build and run: see cpp/tests/CMakeLists.txt, target AllocBench.
#include <algorithm>
#include <atomic>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <new>
#include <span>
#include <string>
#include <vector>

#include "FontRegistry.hpp"
#include "TgfxScene.hpp"
#include "tgfx/core/Canvas.h"
#include "tgfx/core/Color.h"
#include "tgfx/core/Font.h"
#include "tgfx/core/ImageInfo.h"
#include "tgfx/core/Paint.h"
#include "tgfx/core/Surface.h"
#include "tgfx/gpu/Device.h"
#include "tgfx/gpu/metal/MetalDevice.h"

static std::atomic<size_t> gAllocs{0};
static std::atomic<bool> gCounting{false};

void* operator new(size_t size) {
  if (gCounting.load(std::memory_order_relaxed)) {
    gAllocs.fetch_add(1, std::memory_order_relaxed);
  }
  void* p = std::malloc(size ? size : 1);
  if (p == nullptr) throw std::bad_alloc();
  return p;
}
void operator delete(void* p) noexcept { std::free(p); }
void operator delete(void* p, size_t) noexcept { std::free(p); }

namespace {

constexpr int kWidth = 256;
constexpr int kHeight = 256;
constexpr int kNodes = 200;

struct Writer {
  std::vector<double> words{0, 0, 0};
  std::vector<double> patches;
  void push(double v) { words.push_back(v); }
  void pushAnim(double literal, int slot = -1) {
    if (slot >= 0) {
      patches.push_back(static_cast<double>(words.size()));
      patches.push_back(slot);
    }
    words.push_back(literal);
  }
  std::vector<double> finish() {
    auto patchStart = words.size();
    words.push_back(static_cast<double>(patches.size() / 2));
    for (double p : patches) words.push_back(p);
    words[0] = tgfxrn::kSceneVersion;
    words[1] = static_cast<double>(words.size());
    words[2] = static_cast<double>(patchStart);
    return words;
  }
};

/// `filters` adds a colour matrix + a blend mode (no image filter: that is a
/// save-layer, whose cost is inherently per-frame and tgfx's, not ours).
std::vector<double> scene(bool filters) {
  Writer w;
  w.push(kNodes);
  for (int i = 0; i < kNodes; i++) {
    w.push(1);  // Rect
    w.pushAnim((i * 7) % 200);
    w.pushAnim((i * 13) % 200);
    w.pushAnim(24);
    w.pushAnim(24);
    w.push(0xff3366cc);
    w.push(filters ? (2 | 4) : 2);
    w.pushAnim(1);
    w.push(0);
    w.push(0);
    w.pushAnim(1, 0);  // animated alpha: applyPaint runs every frame
    if (filters) {
      w.push(24);  // multiply
      w.push(0);   // colour matrix
      const double m[20] = {0.2, 0.7, 0.1, 0, 0, 0.2, 0.7, 0.1, 0, 0,
                            0.2, 0.7, 0.1, 0, 0, 0,   0,   0,   1, 0};
      for (double v : m) w.push(v);
      w.push(-1);  // no image filter
    }
    w.push(-1);  // no shader
  }
  return w.finish();
}

tgfx::Device* device() {
  static auto shared = tgfx::MetalDevice::Make();
  return shared.get();
}

/// Drawn pixels are read back and counted every frame. A benchmark that
/// measures a scene which never painted measures nothing, so this gates it:
/// `drawn` is asserted by the caller before any number is printed.
size_t frameAllocations(tgfxrn::SceneRenderer& renderer, bool count,
                        size_t* drawn) {
  auto* context = device()->lockContext();
  auto surface = tgfx::Surface::Make(context, kWidth, kHeight);
  auto* canvas = surface->getCanvas();
  canvas->clear();
  gAllocs.store(0);
  gCounting.store(count);
  const double values[1] = {0.9};
  renderer.render(canvas, values);
  gCounting.store(false);
  context->flushAndSubmit(true);
  size_t allocations = gAllocs.load();

  auto info = tgfx::ImageInfo::Make(kWidth, kHeight, tgfx::ColorType::RGBA_8888);
  std::vector<uint8_t> pixels(static_cast<size_t>(info.byteSize()));
  surface->readPixels(info, pixels.data());
  device()->unlock();
  *drawn = 0;
  for (size_t at = 3; at < pixels.size(); at += 4) {
    if (pixels[at] != 0) {
      (*drawn)++;
    }
  }
  return allocations;
}

size_t measure(bool filters, size_t* drawn) {
  tgfxrn::SceneRenderer renderer;
  renderer.setScene(scene(filters), {});
  for (int i = 0; i < 3; i++) {
    frameAllocations(renderer, false, drawn);  // warm up
  }
  size_t best = SIZE_MAX;
  for (int i = 0; i < 5; i++) {
    best = std::min(best, frameAllocations(renderer, true, drawn));
  }
  return best;
}

// ---------------- text ----------------
//
// The claim under test is different in kind from the filter one, so it is
// measured differently: <Text> memoises its layout against a quarter-pixel
// size, which makes a still size much cheaper than the drawSimpleText path it
// replaces and a *moving* one more expensive. Best-of-N would hide that
// entirely — it picks the frame that happened not to cross a quantum — so this
// half reports the mean, over enough frames for the rate to matter.

constexpr int kTextNodes = 100;
constexpr int kTextFrames = 37;
constexpr float kBaseSize = 18;

/// One <Text> per node, all on animation slot 0. Mirrors the Kind.Text case of
/// writeDrawing() in compile.ts.
std::vector<double> textScene() {
  Writer w;
  w.push(kTextNodes);
  for (int i = 0; i < kTextNodes; i++) {
    w.push(8);  // Text
    w.pushAnim(2);
    w.pushAnim(12 + (i % 4) * 12);
    w.push(0);            // "Benchmark"
    w.pushAnim(kBaseSize, 0);
    w.push(1);            // "Helvetica"
    w.push(400);
    w.push(0);            // upright
    w.push(0);            // letterSpacing
    w.push(0);            // no wrap
    w.push(0);            // align left
    w.push(0);            // natural line height
    w.push(0);            // no maxLines
    w.push(2);            // empty ellipsis
    w.push(0xff000000);
    w.push(2);
    w.pushAnim(1);
    w.push(0);
    w.push(0);
    w.pushAnim(1);
    w.push(-1);  // no shader
  }
  return w.finish();
}

/// The pre-#142 draw path, reproduced: a Font held at size 1, copied and
/// re-sized for every draw, rebuilding a TextBlob inside drawSimpleText.
void drawOldPath(tgfx::Canvas* canvas, const tgfx::Font& base, const tgfx::Paint& paint,
                 float size) {
  for (int i = 0; i < kTextNodes; i++) {
    tgfx::Font sized = base;
    sized.setSize(size);
    canvas->drawSimpleText("Benchmark", 2, 12 + static_cast<float>(i % 4) * 12, sized, paint);
  }
}

/// Mean allocations per recorded frame, and the opaque pixels the last one drew.
template <typename Draw>
size_t meanAllocations(Draw&& draw, size_t* drawn) {
  size_t total = 0;
  for (int frame = 0; frame < kTextFrames; frame++) {
    auto* context = device()->lockContext();
    auto surface = tgfx::Surface::Make(context, kWidth, kHeight);
    auto* canvas = surface->getCanvas();
    canvas->clear();
    gAllocs.store(0);
    gCounting.store(true);
    draw(canvas, frame);
    gCounting.store(false);
    total += gAllocs.load();
    context->flushAndSubmit(true);
    auto info = tgfx::ImageInfo::Make(kWidth, kHeight, tgfx::ColorType::RGBA_8888);
    std::vector<uint8_t> pixels(static_cast<size_t>(info.byteSize()));
    surface->readPixels(info, pixels.data());
    device()->unlock();
    *drawn = 0;
    for (size_t at = 3; at < pixels.size(); at += 4) {
      if (pixels[at] != 0) {
        (*drawn)++;
      }
    }
  }
  return total / kTextFrames;
}

/// Returns false when either side drew nothing, which would make the numbers
/// the cost of drawing nothing.
bool reportText() {
  tgfxrn::FontRegistry::instance().clear();
  auto match = tgfxrn::FontRegistry::instance().match("Helvetica", 400, false);
  if (match.typeface == nullptr) {
    std::printf("no typeface for the text bench\n");
    return false;
  }
  tgfx::Font base(match.typeface, 1);
  tgfx::Paint paint;
  paint.setColor(tgfx::Color::Black());
  auto words = textScene();
  const std::vector<std::string> strings{"Benchmark", "Helvetica", ""};

  std::printf("%d <Text> nodes, mean allocations per frame over %d frames:\n", kTextNodes,
              kTextFrames);
  std::printf("  fontSize          old (drawSimpleText)   new (memoised blob)\n");
  for (float step : {0.0f, 0.05f, 0.10f, 0.25f, 1.00f}) {
    size_t oldDrawn = 0, newDrawn = 0;
    size_t oldAllocs = meanAllocations(
        [&](tgfx::Canvas* canvas, int frame) {
          drawOldPath(canvas, base, paint, kBaseSize + step * static_cast<float>(frame));
        },
        &oldDrawn);
    tgfxrn::SceneRenderer renderer;
    renderer.setScene(words, strings);
    size_t newAllocs = meanAllocations(
        [&](tgfx::Canvas* canvas, int frame) {
          double size = kBaseSize + static_cast<double>(step) * frame;
          renderer.render(canvas, std::span<const double>(&size, 1));
        },
        &newDrawn);
    if (oldDrawn == 0 || newDrawn == 0) {
      std::printf("nothing was drawn (%zu / %zu opaque pixels)\n", oldDrawn, newDrawn);
      return false;
    }
    char label[32];
    if (step == 0) {
      std::snprintf(label, sizeof(label), "static");
    } else {
      std::snprintf(label, sizeof(label), "%.2f px/frame", static_cast<double>(step));
    }
    std::printf("  %-16s  %10zu             %10zu\n", label, oldAllocs, newAllocs);
  }
  return true;
}

}  // namespace

int main() {
  if (device() == nullptr) {
    std::printf("no GPU device\n");
    return 1;
  }
  size_t plainPixels = 0, filteredPixels = 0;
  size_t plain = measure(false, &plainPixels);
  size_t filtered = measure(true, &filteredPixels);
  // The gate: both scenes have to have actually painted, or the counts below
  // are the cost of drawing nothing.
  if (plainPixels == 0 || filteredPixels == 0) {
    std::printf("nothing was drawn (%zu / %zu opaque pixels)\n", plainPixels,
                filteredPixels);
    return 1;
  }
  std::printf("opaque pixels drawn: unfiltered %zu, filtered %zu\n", plainPixels,
              filteredPixels);
  std::printf("%d animated rects, allocations during render():\n", kNodes);
  std::printf("  unfiltered            %zu  (%.2f per node)\n", plain,
              double(plain) / kNodes);
  std::printf("  colour matrix + blend %zu  (%.2f per node)\n", filtered,
              double(filtered) / kNodes);
  std::printf("  filters built at compile: %zu\n", tgfxrn::filterBuildCount());
  std::printf("\n");
  return reportText() ? 0 : 1;
}
