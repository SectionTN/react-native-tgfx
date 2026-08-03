// Host tests for the compiled draw program: what setScene is allowed to bake
// into a DrawCmd, and what must still be resolved every frame.
//
// Rendering goes through a real (headless Metal) GPU surface and compares
// pixels, because the invariant that matters is "the cached object draws what
// the per-frame rebuild drew", and no cheaper observation proves that.
//
// Build and run: see cpp/tests/CMakeLists.txt.
#include <algorithm>
#include <array>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <utility>
#include <vector>

#include "ImageRegistry.hpp"
#include "TgfxScene.hpp"
#include "tgfx/core/Canvas.h"
#include "tgfx/core/EncodedFormat.h"
#include "tgfx/core/ImageCodec.h"
#include "tgfx/core/ImageInfo.h"
#include "tgfx/core/Pixmap.h"
#include "tgfx/core/Surface.h"
#include "tgfx/gpu/Device.h"
#include "tgfx/gpu/metal/MetalDevice.h"

namespace {

int failures = 0;

#define CHECK(cond)                                                        \
  do {                                                                     \
    if (!(cond)) {                                                         \
      std::printf("  FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);        \
      failures++;                                                          \
    }                                                                      \
  } while (0)

constexpr int kWidth = 64;
constexpr int kHeight = 64;

/// Mirrors src/compiler/writer.ts: header, node stream, then the patch table.
struct Writer {
  std::vector<double> words{0, 0, 0};
  std::vector<double> patches;

  void push(double value) {
    words.push_back(value);
  }

  /// A field that is either a literal or (slot >= 0) resolved per frame.
  void pushAnim(double literal, int slot = -1) {
    if (slot >= 0) {
      patches.push_back(static_cast<double>(words.size()));
      patches.push_back(slot);
    }
    words.push_back(literal);
  }

  void pushPaint(uint32_t color, bool stroke, double strokeWidth = 1,
                 double alpha = 1, int alphaSlot = -1,
                 int strokeWidthSlot = -1) {
    push(color);
    push((stroke ? 1 : 0) | 2);
    pushAnim(strokeWidth, strokeWidthSlot);
    push(0);
    push(0);
    pushAnim(alpha, alphaSlot);
    push(-1);
  }

  /// One uniform: its name's string index and a component per (value, slot).
  struct Uniform {
    int name;
    std::vector<std::pair<double, int>> components;
  };

  /// A paint whose shader is a runtime shader. Strings: 0 = body, then names.
  void pushRuntimePaint(uint32_t color, const std::vector<Uniform>& uniforms) {
    push(color);
    push(2);
    pushAnim(1);
    push(0);
    push(0);
    pushAnim(1);
    push(6);  // runtime shader
    push(0);  // body
    push(static_cast<double>(uniforms.size()));
    for (const auto& uniform : uniforms) {
      push(uniform.name);
      push(static_cast<double>(uniform.components.size()));
      for (const auto& [value, slot] : uniform.components) {
        pushAnim(value, slot);
      }
    }
  }

  /// An image node: geometry, the registry handle, fit/sampling, an optional
  /// source rect, then a full paint. Mirrors writeDrawing() in compile.ts.
  void pushImage(int32_t handle, double x, double y, double w, double h,
                 int fit = 0, int sampling = 1, const double* srcRect = nullptr) {
    push(7);
    pushAnim(x);
    pushAnim(y);
    pushAnim(w);
    pushAnim(h);
    push(handle);
    push(fit);
    push(sampling);
    if (srcRect == nullptr) {
      push(0);
    } else {
      push(1);
      for (int i = 0; i < 4; i++) {
        push(srcRect[i]);
      }
    }
    pushPaint(0xffffffff, false);
  }

  /// A paint whose shader is an <ImageShader> with no fit rect.
  void pushImageShaderPaint(int32_t handle, int tileX, int tileY,
                            int sampling = 1) {
    push(0xffffffff);
    push(2);
    pushAnim(1);
    push(0);
    push(0);
    pushAnim(1);
    push(7);  // image shader
    push(handle);
    push(tileX);
    push(tileY);
    push(sampling);
    push(0);  // no fit rect
  }

  std::vector<double> finish() {
    auto patchStart = words.size();
    words.push_back(static_cast<double>(patches.size() / 2));
    for (double patch : patches) {
      words.push_back(patch);
    }
    words[0] = tgfxrn::kSceneVersion;
    words[1] = static_cast<double>(words.size());
    words[2] = static_cast<double>(patchStart);
    return words;
  }
};

tgfx::Device* device() {
  static auto shared = tgfx::MetalDevice::Make();
  return shared.get();
}

using Pixels = std::vector<uint8_t>;

/// Draw one frame of `renderer`'s already-compiled program against `values`.
/// Separate from render() so a test can prove what a *second* frame does
/// without recompiling the scene between them.
Pixels drawFrame(tgfxrn::SceneRenderer& renderer, const std::vector<double>& values) {
  auto* context = device()->lockContext();
  auto surface = tgfx::Surface::Make(context, kWidth, kHeight);
  auto* canvas = surface->getCanvas();
  canvas->clear();
  renderer.render(canvas, values);
  context->flushAndSubmit(true);
  auto info = tgfx::ImageInfo::Make(kWidth, kHeight, tgfx::ColorType::RGBA_8888);
  Pixels pixels(static_cast<size_t>(info.byteSize()));
  surface->readPixels(info, pixels.data());
  device()->unlock();
  return pixels;
}

/// Compile `words` and draw one frame against `values`, returning the pixels.
Pixels render(const std::vector<double>& words,
              const std::vector<std::string>& strings,
              const std::vector<double>& values) {
  tgfxrn::SceneRenderer renderer;
  renderer.setScene(words, strings);
  return drawFrame(renderer, values);
}

bool anyPixelSet(const Pixels& pixels) {
  for (uint8_t byte : pixels) {
    if (byte != 0) {
      return true;
    }
  }
  return false;
}

/// A distinct opaque colour per image index.
std::array<uint8_t, 4> cellColor(int index) {
  return {static_cast<uint8_t>(10 + index * 6),
          static_cast<uint8_t>(200 - index * 4),
          static_cast<uint8_t>(60 + index * 3), 255};
}

/// Encode `pixels` as a PNG and register it, the way the TgfxImage hybrid
/// object does from a background thread. Returns the handle the program carries.
tgfxrn::ImageHandle registerPixels(int width, int height,
                                   const std::vector<uint8_t>& pixels) {
  auto info = tgfx::ImageInfo::Make(width, height, tgfx::ColorType::RGBA_8888,
                                    tgfx::AlphaType::Premultiplied);
  tgfx::Pixmap pixmap(info, pixels.data());
  auto data = tgfx::ImageCodec::Encode(pixmap, tgfx::EncodedFormat::PNG, 100);
  if (data == nullptr) {
    return {};
  }
  return tgfxrn::ImageRegistry::instance().add(
      tgfx::ImageCodec::MakeFrom(std::move(data)));
}

/// A solid image of `rgba`.
tgfxrn::ImageHandle registerSolid(const std::array<uint8_t, 4>& rgba,
                                  int width = 2, int height = 2) {
  std::vector<uint8_t> pixels(static_cast<size_t>(width) * height * 4);
  for (size_t i = 0; i < pixels.size(); i += 4) {
    std::copy(rgba.begin(), rgba.end(), pixels.begin() + static_cast<long>(i));
  }
  return registerPixels(width, height, pixels);
}

/// The pixel at (x, y) as RGB.
std::array<uint8_t, 3> pixelAt(const Pixels& pixels, int x, int y) {
  size_t at = (static_cast<size_t>(y) * kWidth + static_cast<size_t>(x)) * 4;
  return {pixels[at], pixels[at + 1], pixels[at + 2]};
}

bool opaqueAt(const Pixels& pixels, int x, int y) {
  return pixels[(static_cast<size_t>(y) * kWidth + static_cast<size_t>(x)) * 4 + 3] > 0;
}

/// A rect whose paint alpha is a literal, versus the same alpha as a slot.
void staticPaintDrawsWhatTheRebuildDraws() {
  Writer literal;
  literal.push(1);
  literal.push(1);  // Rect
  literal.pushAnim(8);
  literal.pushAnim(8);
  literal.pushAnim(40);
  literal.pushAnim(40);
  literal.pushPaint(0xff3366cc, false, 1, 0.5);

  Writer animated;
  animated.push(1);
  animated.push(1);
  animated.pushAnim(8);
  animated.pushAnim(8);
  animated.pushAnim(40);
  animated.pushAnim(40);
  animated.pushPaint(0xff3366cc, false, 1, 0, 0);

  auto cached = render(literal.finish(), {}, {});
  auto rebuilt = render(animated.finish(), {}, {0.5});
  CHECK(anyPixelSet(cached));
  CHECK(cached == rebuilt);
}

/// A static line's baked path must draw what the per-frame path drew.
void staticLineDrawsWhatTheRebuildDraws() {
  Writer literal;
  literal.push(1);
  literal.push(5);  // Line
  literal.pushAnim(8);
  literal.pushAnim(8);
  literal.pushAnim(56);
  literal.pushAnim(48);
  literal.pushPaint(0xffcc3366, true, 3);

  Writer animated;
  animated.push(1);
  animated.push(5);
  animated.pushAnim(0, 0);
  animated.pushAnim(8);
  animated.pushAnim(56);
  animated.pushAnim(48);
  animated.pushPaint(0xffcc3366, true, 3);

  auto cached = render(literal.finish(), {}, {});
  auto rebuilt = render(animated.finish(), {}, {8});
  CHECK(anyPixelSet(cached));
  CHECK(cached == rebuilt);
}

/// A stroked rect whose strokeWidth is a slot must rebuild rather than reuse
/// `cached`, and must actually track the slot from frame to frame.
void animatedStrokeWidthDrawsWhatTheRebuildDraws() {
  Writer literal;
  literal.push(1);
  literal.push(1);  // Rect
  literal.pushAnim(8);
  literal.pushAnim(8);
  literal.pushAnim(40);
  literal.pushAnim(40);
  literal.pushPaint(0xffcc3366, true, 6);

  Writer animated;
  animated.push(1);
  animated.push(1);
  animated.pushAnim(8);
  animated.pushAnim(8);
  animated.pushAnim(40);
  animated.pushAnim(40);
  animated.pushPaint(0xffcc3366, true, 0, 1, -1, 0);

  auto words = animated.finish();
  auto cached = render(literal.finish(), {}, {});
  CHECK(anyPixelSet(cached));
  CHECK(cached == render(words, {}, {6}));
  CHECK(cached != render(words, {}, {2}));
}

const std::vector<std::string> kTextStrings{"Wg", "Helvetica"};

void writeText(Writer& w, double fontSize, int fontSizeSlot) {
  w.push(1);
  w.push(8);  // Text
  w.pushAnim(4);
  w.pushAnim(44);
  w.push(0);  // text string index
  w.pushAnim(fontSize, fontSizeSlot);
  w.push(1);  // font family string index
  w.pushPaint(0xff000000, false);
}

/// A static font must draw what the per-frame font construction drew.
void staticTextDrawsWhatTheRebuildDraws() {
  Writer literal;
  writeText(literal, 20, -1);
  Writer animated;
  writeText(animated, 0, 0);

  auto cached = render(literal.finish(), kTextStrings, {});
  auto rebuilt = render(animated.finish(), kTextStrings, {20});
  CHECK(anyPixelSet(cached));
  CHECK(cached == rebuilt);
}

/// An animated field must still move after the invariant parts are cached.
void animatedFieldsStillAnimate() {
  Writer rect;
  rect.push(1);
  rect.push(1);
  rect.pushAnim(0, 0);
  rect.pushAnim(8);
  rect.pushAnim(16);
  rect.pushAnim(16);
  rect.pushPaint(0xff3366cc, false);
  auto rectWords = rect.finish();
  CHECK(render(rectWords, {}, {4}) != render(rectWords, {}, {40}));

  Writer alpha;
  alpha.push(1);
  alpha.push(1);
  alpha.pushAnim(8);
  alpha.pushAnim(8);
  alpha.pushAnim(40);
  alpha.pushAnim(40);
  alpha.pushPaint(0xff3366cc, false, 1, 0, 0);
  auto alphaWords = alpha.finish();
  CHECK(render(alphaWords, {}, {1.0}) != render(alphaWords, {}, {0.25}));

  Writer line;
  line.push(1);
  line.push(5);
  line.pushAnim(8);
  line.pushAnim(8);
  line.pushAnim(0, 0);
  line.pushAnim(48);
  line.pushPaint(0xffcc3366, true, 3);
  auto lineWords = line.finish();
  CHECK(render(lineWords, {}, {20}) != render(lineWords, {}, {56}));

  Writer text;
  writeText(text, 0, 0);
  auto textWords = text.finish();
  auto small = render(textWords, kTextStrings, {10});
  auto large = render(textWords, kTextStrings, {30});
  CHECK(anyPixelSet(small));
  CHECK(small != large);
}

}  // namespace

/// A uniform on a slot must draw what the same uniform as a literal drew, and
/// must still move when the slot value changes -- the shader is rebuilt per
/// frame, so a stale cached paint would pin it to its first value.
///
/// The animated component sits between static ones and behind a multi-component
/// uniform, because the slots are held in one flat run across all uniforms: a
/// run that restarted per uniform, or ran in the wrong order, would read a
/// static component here and still draw the right thing for a single uniform.
void animatedUniformDrawsWhatTheRebuildDraws() {
  const std::vector<std::string> strings = {
      "return vec4(uLevel, uTint) + vec4(uPad.x, uPad.y, 0.0, 0.0);", "uTint",
      "uLevel", "uPad", ""};
  const std::vector<Writer::Uniform> baseUniforms = {
      {1, {{0.1, -1}, {0.2, -1}, {0.3, -1}}},
      {2, {{0.6, -1}}},
      {3, {{0.05, -1}, {0.0, -1}}},
  };
  auto slotted = baseUniforms;
  // Slot 1, not 0: a build that resolved every animated component against
  // values[0] would survive a test that only ever used the first slot.
  slotted[1].components[0] = {0, 1};

  auto write = [](const std::vector<Writer::Uniform>& uniforms) {
    Writer w;
    w.push(1);
    w.push(1);  // Rect
    w.pushAnim(8);
    w.pushAnim(8);
    w.pushAnim(40);
    w.pushAnim(40);
    w.pushRuntimePaint(0xff000000, uniforms);
    return w.finish();
  };

  auto words = write(slotted);
  auto baked = render(write(baseUniforms), strings, {});
  auto resolved = render(words, strings, {0.0, 0.6});
  CHECK(anyPixelSet(baked));
  CHECK(baked == resolved);

  // Same compiled program, different value: the second frame must differ.
  CHECK(render(words, strings, {0.0, 0.2}) != resolved);

  // An empty-named uniform is dropped, and must take its slots with it or the
  // flat run desyncs and every survivor reads the wrong component.
  auto withDropped = slotted;
  withDropped.insert(withDropped.begin(), {4, {{0.9, 0}, {0.9, -1}}});
  CHECK(render(write(withDropped), strings, {0.0, 0.6}) == baked);
}

/// A Fill must cover the whole surface, not just where a rect would have been,
/// and must carry a shader like any other drawing.
void fillCoversTheWholeCanvas() {
  Writer fill;
  fill.push(1);
  fill.push(9);  // Fill: no geometry words
  fill.pushPaint(0xff3366cc, false);

  Writer rect;
  rect.push(1);
  rect.push(1);  // Rect
  rect.pushAnim(0);
  rect.pushAnim(0);
  rect.pushAnim(kWidth);
  rect.pushAnim(kHeight);
  rect.pushPaint(0xff3366cc, false);

  auto filled = render(fill.finish(), {}, {});
  CHECK(anyPixelSet(filled));
  CHECK(filled == render(rect.finish(), {}, {}));

  // A Fill smaller than the surface would match a half-height rect instead.
  Writer half;
  half.push(1);
  half.push(1);
  half.pushAnim(0);
  half.pushAnim(0);
  half.pushAnim(kWidth);
  half.pushAnim(kHeight / 2);
  half.pushPaint(0xff3366cc, false);
  CHECK(filled != render(half.finish(), {}, {}));

  // A Fill must carry a shader and an animated alpha like any other drawing,
  // so dropping either on this kind alone has to fail.
  const std::vector<std::string> strings = {
      "return vec4(uLevel, 0.0, 0.0, 1.0);", "uLevel"};
  const std::vector<Writer::Uniform> uniforms = {{1, {{0, 0}}}};

  Writer shaded;
  shaded.push(1);
  shaded.push(9);
  shaded.pushRuntimePaint(0xff000000, uniforms);
  // finish() appends a patch table, so it must be called once per writer.
  auto shadedWords = shaded.finish();
  auto shadedPixels = render(shadedWords, strings, {0.75});
  CHECK(anyPixelSet(shadedPixels));
  // Without the shader the paint is opaque black, and the uniform must reach it.
  CHECK(shadedPixels != filled);
  CHECK(shadedPixels != render(shadedWords, strings, {0.25}));

  Writer faded;
  faded.push(1);
  faded.push(9);
  faded.pushPaint(0xff3366cc, false, 1, 0, 0);
  CHECK(render(faded.finish(), {}, {0.5}) != filled);
}

/// Images are addressed by an integer handle, so more of them on screen than
/// any cache bound must still each draw their own pixels.
void everyImageDrawsItsOwnHandle() {
  constexpr int kCount = 40;
  constexpr int kCell = 8;
  Writer w;
  w.push(kCount);
  for (int i = 0; i < kCount; i++) {
    auto image = registerSolid(cellColor(i));
    CHECK(image.handle != 0 && image.width == 2 && image.height == 2);
    w.pushImage(image.handle, (i % kCell) * kCell, (i / kCell) * kCell, kCell,
                kCell);
  }
  auto pixels = render(w.finish(), {}, {});
  for (int i = 0; i < kCount; i++) {
    auto color = cellColor(i);
    auto got = pixelAt(pixels, (i % kCell) * kCell + kCell / 2,
                       (i / kCell) * kCell + kCell / 2);
    CHECK(got[0] == color[0] && got[1] == color[1] && got[2] == color[2]);
  }
}

/// Re-committing a scene whose images have not changed must cost no decode at
/// all: the handle is an integer lookup, not a hash of the payload.
void reCommittingAnImageSceneDecodesNothing() {
  auto& registry = tgfxrn::ImageRegistry::instance();
  auto image = registerSolid(cellColor(3));
  size_t before = registry.decodeCount();

  tgfxrn::SceneRenderer renderer;
  for (int i = 0; i < 5; i++) {
    Writer w;
    w.push(1);
    // A different geometry each time, so the scene really is recompiled.
    w.pushImage(image.handle, i, 0, 8, 8);
    renderer.setScene(w.finish(), {});
  }
  CHECK(registry.decodeCount() == before);
}

/// The decoded-pixel budget is bytes with a real LRU, not a count with FIFO:
/// a hit has to refresh recency, or the image most likely to still be on screen
/// is the one evicted. Invisible in the pixels, so it is counted instead.
void theByteBudgetEvictsLeastRecentlyUsed() {
  auto& registry = tgfxrn::ImageRegistry::instance();
  size_t restore = registry.cacheLimit();
  // 32x32 RGBA is 4096 B; a budget of three of them.
  auto a = registerSolid(cellColor(1), 32, 32);
  auto b = registerSolid(cellColor(2), 32, 32);
  auto c = registerSolid(cellColor(3), 32, 32);
  auto d = registerSolid(cellColor(4), 32, 32);
  CHECK(d.handle != 0);
  // Registration order is recency order, so this drops A, the oldest.
  registry.setCacheLimit(3 * 32 * 32 * 4);
  CHECK(registry.cachedBytes() <= 3 * 32 * 32 * 4);
  size_t decodes = registry.decodeCount();

  // acquire() is called on the render thread, so an evicted entry must come
  // back empty — a node skips a frame — rather than decoding inline.
  CHECK(registry.acquire(a.handle) == nullptr);
  CHECK(registry.decodeCount() == decodes);
  registry.waitForDecodes();
  CHECK(registry.decodeCount() == decodes + 1);
  CHECK(registry.acquire(a.handle) != nullptr);
  // A came back at the head, so B is now the least recently used one.
  CHECK(registry.acquire(b.handle) == nullptr);

  // A hit on C refreshes its recency, so bringing B back evicts D instead.
  CHECK(registry.acquire(c.handle) != nullptr);
  registry.waitForDecodes();
  CHECK(registry.decodeCount() == decodes + 2);
  CHECK(registry.acquire(c.handle) != nullptr);
  CHECK(registry.acquire(d.handle) == nullptr);

  registry.waitForDecodes();
  registry.setCacheLimit(restore);
}


/// `fit` follows Skia (Flutter's BoxFit): cover crops the source rather than
/// overflowing the destination, and contain letterboxes inside it.
void fitModesLetterboxAndCrop() {
  // 4x2, so twice as wide as it is tall, drawn into a 32x32 box at the origin.
  auto image = registerSolid(cellColor(7), 4, 2);
  auto draw = [&](int fit) {
    Writer w;
    w.push(1);
    w.pushImage(image.handle, 0, 0, 32, 32, fit);
    return render(w.finish(), {}, {});
  };

  auto contain = draw(1);
  CHECK(opaqueAt(contain, 16, 16));   // the letterboxed band
  CHECK(!opaqueAt(contain, 16, 2));   // above it, untouched
  CHECK(!opaqueAt(contain, 16, 30));

  auto cover = draw(2);
  CHECK(opaqueAt(cover, 16, 2));      // fills the box
  CHECK(opaqueAt(cover, 16, 30));
  CHECK(!opaqueAt(cover, 40, 16));    // but never past it

  auto fill = draw(0);
  CHECK(opaqueAt(fill, 1, 1) && opaqueAt(fill, 30, 30));

  // `none` draws at native size, centred: 4x2 in the middle of the box.
  auto none = draw(5);
  CHECK(opaqueAt(none, 16, 16));
  CHECK(!opaqueAt(none, 16, 4));
}

/// A source rect picks one sprite out of a sheet without slicing it in JS.
void aSourceRectPicksOneSprite() {
  // Two side-by-side pixels: left is cellColor(1), right is cellColor(9).
  auto left = cellColor(1);
  auto right = cellColor(9);
  std::vector<uint8_t> pixels(8);
  std::copy(left.begin(), left.end(), pixels.begin());
  std::copy(right.begin(), right.end(), pixels.begin() + 4);
  auto image = registerPixels(2, 1, pixels);
  CHECK(image.handle != 0);

  const double rightHalf[4] = {1, 0, 1, 1};
  Writer w;
  w.push(1);
  w.pushImage(image.handle, 0, 0, 32, 32, 0, 0, rightHalf);
  auto got = pixelAt(render(w.finish(), {}, {}), 16, 16);
  CHECK(got[0] == right[0] && got[1] == right[1] && got[2] == right[2]);
}

/// <ImageShader>: an image as the paint source, tiled across a shape.
void anImageShaderTilesAcrossAShape() {
  // A 2x1 image, two different colours, repeated across a 32x32 rect.
  auto left = cellColor(2);
  auto right = cellColor(20);
  std::vector<uint8_t> pixels(8);
  std::copy(left.begin(), left.end(), pixels.begin());
  std::copy(right.begin(), right.end(), pixels.begin() + 4);
  auto image = registerPixels(2, 1, pixels);

  Writer w;
  w.push(1);
  w.push(1);  // Rect
  w.pushAnim(0);
  w.pushAnim(0);
  w.pushAnim(32);
  w.pushAnim(32);
  w.pushImageShaderPaint(image.handle, 1, 1, 0);  // repeat/repeat, nearest
  auto drawn = render(w.finish(), {}, {});

  auto at0 = pixelAt(drawn, 0, 0);
  auto at1 = pixelAt(drawn, 1, 0);
  auto at2 = pixelAt(drawn, 2, 0);
  CHECK(at0[0] == left[0] && at0[1] == left[1]);
  CHECK(at1[0] == right[0] && at1[1] == right[1]);
  // The third column proves it repeated rather than clamped.
  CHECK(at2[0] == at0[0] && at2[1] == at0[1]);
  // Mirror puts the *right* colour next to itself at the seam instead.
  Writer m;
  m.push(1);
  m.push(1);
  m.pushAnim(0);
  m.pushAnim(0);
  m.pushAnim(32);
  m.pushAnim(32);
  m.pushImageShaderPaint(image.handle, 2, 1, 0);
  auto mirrored = render(m.finish(), {}, {});
  auto m2 = pixelAt(mirrored, 2, 0);
  CHECK(m2[0] == right[0] && m2[1] == right[1]);
}

/// A hardware-buffer handle (the camera path, #132) is registered rather than
/// decoded: it stays out of the byte budget, and a new frame replaces the image
/// behind the same id. The scene is compiled ONCE here, so what the second frame
/// draws is decided entirely by the draw path re-reading the handle.
void anExternalHandleIsReplacedInPlaceAndNotBudgeted() {
  auto& registry = tgfxrn::ImageRegistry::instance();
  // Stands in for the imported buffer: registry-side semantics are the same
  // whichever tgfx::Image the import produced.
  auto first = registerSolid(cellColor(11), 32, 32);
  auto second = registerSolid(cellColor(29), 32, 32);
  auto frameA = registry.acquire(first.handle);
  auto frameB = registry.acquire(second.handle);
  CHECK(frameA != nullptr && frameB != nullptr);

  size_t bytesBefore = registry.cachedBytes();
  auto external = registry.addExternal(frameA);
  CHECK(external.handle != 0 && external.width == 32);
  // Not the producer's memory to budget.
  CHECK(registry.cachedBytes() == bytesBefore);

  Writer w;
  w.push(1);
  w.pushImage(external.handle, 0, 0, 32, 32);
  tgfxrn::SceneRenderer renderer;
  renderer.setScene(w.finish(), {});
  uint64_t epochBefore = registry.epoch();

  auto expectedFirst = cellColor(11);
  auto before = pixelAt(drawFrame(renderer, {}), 16, 16);
  CHECK(before[0] == expectedFirst[0] && before[1] == expectedFirst[1]);

  // The next frame: same handle id, same compiled program, new pixels.
  CHECK(registry.replaceExternal(external.handle, frameB));
  // A swap with no commit behind it still has to wake the render loop.
  CHECK(registry.epoch() != epochBefore);
  // ...and the registry lets go of the previous buffer there and then, rather
  // than starving the producer's pool until the scene is next recompiled. Two
  // references left: this test's local and the decoded entry it came from.
  CHECK(frameA.use_count() == 2);

  auto expectedSecond = cellColor(29);
  auto after = pixelAt(drawFrame(renderer, {}), 16, 16);
  CHECK(after[0] == expectedSecond[0] && after[1] == expectedSecond[1]);

  // A decoded asset handle is not replaceable this way.
  CHECK(!registry.replaceExternal(first.handle, frameA));
  registry.remove(external.handle);
}

/// The same per-frame contract for <ImageShader>, whose shader is otherwise
/// built once at setScene and would freeze on the first camera frame.
void anExternalHandleAlsoDrivesAnImageShaderPerFrame() {
  auto& registry = tgfxrn::ImageRegistry::instance();
  auto first = registerSolid(cellColor(13), 32, 32);
  auto second = registerSolid(cellColor(31), 32, 32);
  auto external = registry.addExternal(registry.acquire(first.handle));
  CHECK(external.handle != 0);

  Writer w;
  w.push(1);
  w.push(1);  // Rect
  w.pushAnim(0);
  w.pushAnim(0);
  w.pushAnim(32);
  w.pushAnim(32);
  w.pushImageShaderPaint(external.handle, 0, 0);
  tgfxrn::SceneRenderer renderer;
  renderer.setScene(w.finish(), {});

  auto expectedFirst = cellColor(13);
  auto before = pixelAt(drawFrame(renderer, {}), 16, 16);
  CHECK(before[0] == expectedFirst[0] && before[1] == expectedFirst[1]);

  CHECK(registry.replaceExternal(external.handle, registry.acquire(second.handle)));
  auto expectedSecond = cellColor(31);
  auto after = pixelAt(drawFrame(renderer, {}), 16, 16);
  CHECK(after[0] == expectedSecond[0] && after[1] == expectedSecond[1]);
  registry.remove(external.handle);
}

/// An asset the byte budget dropped *before* the scene compiled has nothing to
/// cache at setScene. Its re-decode lands afterwards, and the already-compiled
/// program has to be able to reach it — otherwise the fix for "never decode on
/// the render thread" trades a stall for a permanently blank tile, which is
/// worse than what it replaced. Counting decodes cannot see this; only a frame can.
void anImageEvictedBeforeCompileComesBackWhenItsDecodeLands() {
  auto& registry = tgfxrn::ImageRegistry::instance();
  size_t restore = registry.cacheLimit();
  auto victim = registerSolid(cellColor(17), 32, 32);
  auto keep = registerSolid(cellColor(23), 32, 32);
  CHECK(keep.handle != 0);
  // Room for one, so `victim` — registered first, so least recently used — goes.
  registry.setCacheLimit(32 * 32 * 4);
  size_t decodes = registry.decodeCount();

  Writer w;
  w.push(1);
  w.pushImage(victim.handle, 0, 0, 32, 32);
  tgfxrn::SceneRenderer renderer;
  // Nothing has acquired `victim` since the eviction, so this compile is
  // guaranteed to be the one that finds it empty and schedules the re-decode.
  renderer.setScene(w.finish(), {});

  registry.setCacheLimit(restore);
  registry.waitForDecodes();
  // The compile really did fail to resolve it: the re-decode it scheduled ran.
  CHECK(registry.decodeCount() == decodes + 1);
  CHECK(registry.acquire(victim.handle) != nullptr);

  // Same renderer, same program, no re-commit: the pixels are back, so the
  // frame must show them.
  auto expected = cellColor(17);
  auto after = pixelAt(drawFrame(renderer, {}), 16, 16);
  CHECK(after[0] == expected[0] && after[1] == expected[1]);
}

/// Every epoch bump has to reach the platform render loops. Both are
/// push-driven — Android posts one draw per staging call, iOS pauses its display
/// link after a few idle ticks — so a swap that only moves the epoch schedules
/// no frame at all and a static scene fed by setNativeBuffer freezes.
void aBufferSwapSchedulesADraw() {
  auto& registry = tgfxrn::ImageRegistry::instance();
  int wakes = 0;
  auto token = registry.addWakeListener([&wakes] { wakes++; });

  auto first = registerSolid(cellColor(11), 32, 32);
  auto second = registerSolid(cellColor(29), 32, 32);
  auto external = registry.addExternal(registry.acquire(first.handle));
  int before = wakes;
  CHECK(registry.replaceExternal(external.handle, registry.acquire(second.handle)));
  CHECK(wakes == before + 1);

  // And a disposed handle, so a view still drawing it is told to stop.
  registry.remove(external.handle);
  CHECK(wakes == before + 2);
  registry.removeWakeListener(token);
  registry.replaceExternal(external.handle, registry.acquire(first.handle));
  CHECK(wakes == before + 2);
}

/// A handle JS has disposed must draw nothing, not somebody else's bitmap.
void aDisposedHandleDrawsNothing() {
  auto image = registerSolid(cellColor(5));
  tgfxrn::ImageRegistry::instance().remove(image.handle);
  Writer w;
  w.push(1);
  w.pushImage(image.handle, 0, 0, 32, 32);
  CHECK(!anyPixelSet(render(w.finish(), {}, {})));
}

int main() {
  if (device() == nullptr) {
    std::printf("no GPU device available\n");
    return 1;
  }
  staticPaintDrawsWhatTheRebuildDraws();
  staticLineDrawsWhatTheRebuildDraws();
  animatedStrokeWidthDrawsWhatTheRebuildDraws();
  staticTextDrawsWhatTheRebuildDraws();
  animatedFieldsStillAnimate();
  animatedUniformDrawsWhatTheRebuildDraws();
  fillCoversTheWholeCanvas();
  everyImageDrawsItsOwnHandle();
  reCommittingAnImageSceneDecodesNothing();
  theByteBudgetEvictsLeastRecentlyUsed();
  fitModesLetterboxAndCrop();
  aSourceRectPicksOneSprite();
  anImageShaderTilesAcrossAShape();
  anExternalHandleIsReplacedInPlaceAndNotBudgeted();
  anExternalHandleAlsoDrivesAnImageShaderPerFrame();
  anImageEvictedBeforeCompileComesBackWhenItsDecodeLands();
  aBufferSwapSchedulesADraw();
  aDisposedHandleDrawsNothing();
  std::printf(failures == 0 ? "SceneTest: ok\n" : "SceneTest: %d failure(s)\n",
              failures);
  return failures == 0 ? 0 : 1;
}
