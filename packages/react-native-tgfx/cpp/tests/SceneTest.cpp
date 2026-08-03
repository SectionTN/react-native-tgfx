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

  /// A paint's filter block: blend mode, then the colour and image filter,
  /// each a kind code (-1 for none) followed by its own words.
  struct Filters {
    int blend = 3;  // SrcOver
    std::vector<double> colorFilter{-1};
    std::vector<double> imageFilter{-1};
  };

  /// The same paint as pushPaint, with flag bit 4 and the filter block set.
  /// `alphaSlot >= 0` puts the paint on the per-frame path, so applyPaint runs
  /// every frame rather than the compiled `cached` paint being handed over.
  void pushFilteredPaint(uint32_t color, const Filters& filters,
                         int alphaSlot = -1, double strokeWidth = 1) {
    push(color);
    push(2 | 4);
    pushAnim(strokeWidth);
    push(0);
    push(0);
    pushAnim(1, alphaSlot);
    push(filters.blend);
    for (double word : filters.colorFilter) {
      push(word);
    }
    for (double word : filters.imageFilter) {
      push(word);
    }
    push(-1);  // no shader
  }

  /// One uniform: its name's string index and a component per (value, slot).
  struct Uniform {
    int name;
    std::vector<std::pair<double, int>> components;
  };

  /// A paint whose shader is a runtime shader. Strings: 0 = body, then names.
  /// `preamble` and `functions` are string indices; the caller supplies an empty
  /// entry for the preamble when the shader declares no helper.
  void pushRuntimePaint(uint32_t color, const std::vector<Uniform>& uniforms, int preamble,
                        const std::vector<int>& functions = {}) {
    push(color);
    push(2);
    pushAnim(1);
    push(0);
    push(0);
    pushAnim(1);
    push(6);  // runtime shader
    push(0);  // body
    push(preamble);
    push(static_cast<double>(functions.size()));
    for (int function : functions) {
      push(function);
    }
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
    w.pushRuntimePaint(0xff000000, uniforms, 4);
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

/// A helper declared by the author has to reach the shader at file scope: GLSL
/// ES has no nested functions, so splicing it into the body is a driver compile
/// error and an unpainted shape.
///
/// Two shaders whose helpers share a name are drawn in one scene, with the SAME
/// body -- so only the preamble tells the two programs apart. The body hash in
/// onComputeProcessorKey cannot carry this; drop the preamble from that key and
/// the second draw reuses the first's program and paints the wrong value.
void aHelperFunctionCompilesAndDoesNotCollide() {
  const std::vector<std::string> strings = {
      "return vec4(tint(uLevel), 0.0, 0.0, 1.0);",  // 0: the only body
      "uLevel",                                     // 1
      "float tint(float v) { return v; }",          // 2: identity preamble
      "tint",                                       // 3
      "float tint(float v) { return 1.0 - v; }",    // 4: inverting preamble
      "",                                           // 5: no preamble
  };
  const std::vector<Writer::Uniform> uniforms = {{1, {{0.75, -1}}}};

  auto draw = [&](int preamble, const std::vector<int>& functions) {
    Writer w;
    w.push(1);
    w.push(1);  // Rect
    w.pushAnim(8);
    w.pushAnim(8);
    w.pushAnim(40);
    w.pushAnim(40);
    w.pushRuntimePaint(0xff000000, uniforms, preamble, functions);
    return render(w.finish(), strings, {});
  };

  // Emitting the helper at file scope at all: without it the body calls an
  // undeclared tint, the driver rejects the program and nothing paints.
  auto identity = draw(2, {3});
  CHECK(anyPixelSet(identity));
  // uLevel is 0.75, so this draws red 0.75 and the next draws red 0.25 through
  // a helper of the same name -- one body, two programs.
  auto inverted = draw(4, {3});
  CHECK(anyPixelSet(inverted));
  CHECK(identity != inverted);
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
      "return vec4(uLevel, 0.0, 0.0, 1.0);", "uLevel", ""};
  const std::vector<Writer::Uniform> uniforms = {{1, {{0, 0}}}};

  Writer shaded;
  shaded.push(1);
  shaded.push(9);
  shaded.pushRuntimePaint(0xff000000, uniforms, 2);
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

/// The blend mode has to reach the paint, so a drawing composites against what
/// is already on the surface instead of replacing it.
void aBlendModeCompositesAgainstWhatIsBelow() {
  // Yellow under, magenta over. Multiply keeps only the channels both have: red.
  auto scene = [](int blend) {
    Writer w;
    w.push(2);
    w.push(1);  // Rect: the backdrop
    w.pushAnim(0);
    w.pushAnim(0);
    w.pushAnim(32);
    w.pushAnim(32);
    w.pushPaint(0xffffff00, false);
    w.push(1);  // Rect: drawn over it
    w.pushAnim(0);
    w.pushAnim(0);
    w.pushAnim(32);
    w.pushAnim(32);
    if (blend < 0) {
      w.pushPaint(0xffff00ff, false);
    } else {
      w.pushFilteredPaint(0xffff00ff, {blend, {-1}, {-1}});
    }
    return render(w.finish(), {}, {});
  };

  auto over = scene(-1);
  auto multiply = scene(24);  // BlendMode::Multiply
  CHECK(anyPixelSet(over));
  auto plain = pixelAt(over, 16, 16);
  CHECK(plain[0] == 255 && plain[1] == 0 && plain[2] == 255);
  auto blended = pixelAt(multiply, 16, 16);
  CHECK(blended[0] == 255 && blended[1] == 0 && blended[2] == 0);

  // An explicit srcOver must be byte-identical to writing no filter block at
  // all, or the flag bit is changing more than it claims to.
  Writer srcOver;
  srcOver.push(2);
  srcOver.push(1);
  srcOver.pushAnim(0);
  srcOver.pushAnim(0);
  srcOver.pushAnim(32);
  srcOver.pushAnim(32);
  srcOver.pushPaint(0xffffff00, false);
  srcOver.push(1);
  srcOver.pushAnim(0);
  srcOver.pushAnim(0);
  srcOver.pushAnim(32);
  srcOver.pushAnim(32);
  srcOver.pushFilteredPaint(0xffff00ff, {3, {-1}, {-1}});
  CHECK(render(srcOver.finish(), {}, {}) == over);
}

/// A blend mode and an image filter on one paint must both survive. An image
/// filter forces an offscreen layer, and a blend mode left on the inner draw
/// composites against the empty layer instead of against the canvas — so this
/// fails with the blurred rect coming back magenta rather than red.
void aBlendModeSurvivesAnImageFilter() {
  // Same yellow-under-magenta multiply as above, but blurred. Sigma is small
  // enough that the centre pixel is the unblurred colour either way.
  auto scene = [](double sigma) {
    Writer w;
    w.push(3);
    w.push(1);  // Rect: the backdrop
    w.pushAnim(0);
    w.pushAnim(0);
    w.pushAnim(32);
    w.pushAnim(32);
    w.pushPaint(0xffffff00, false);
    w.push(1);  // Rect: multiplied over it
    w.pushAnim(0);
    w.pushAnim(0);
    w.pushAnim(32);
    w.pushAnim(32);
    std::vector<double> blur{-1};
    if (sigma > 0) {
      blur = {0, sigma, sigma, 3};
    }
    w.pushFilteredPaint(0xffff00ff, {24, {-1}, blur});  // BlendMode::Multiply
    w.push(1);  // Rect: an ordinary green one, drawn after the layered node
    w.pushAnim(44);
    w.pushAnim(44);
    w.pushAnim(16);
    w.pushAnim(16);
    w.pushPaint(0xff00ff00, false);
    return render(w.finish(), {}, {});
  };

  auto sharp = pixelAt(scene(0), 16, 16);
  CHECK(sharp[0] == 255 && sharp[1] == 0 && sharp[2] == 0);
  auto blurred = pixelAt(scene(0.5), 16, 16);
  CHECK(blurred[0] == 255 && blurred[1] == 0 && blurred[2] == 0);
  // The layer is still real: the blur has to reach past the rect's own edge.
  CHECK(opaqueAt(scene(6), 34, 16));
  // ...and it was closed again: the next node draws on the canvas, not into it.
  auto after = pixelAt(scene(0.5), 52, 52);
  CHECK(after[0] == 0 && after[1] == 255 && after[2] == 0);
}

/// A 4x5 colour matrix must transform the drawn colour, and the identity
/// matrix must leave it exactly as an unfiltered paint drew it.
void aColourMatrixTransformsTheDrawnColour() {
  auto draw = [](const std::vector<double>& matrix) {
    Writer w;
    w.push(1);
    w.push(1);  // Rect
    w.pushAnim(0);
    w.pushAnim(0);
    w.pushAnim(32);
    w.pushAnim(32);
    std::vector<double> filter{0};
    filter.insert(filter.end(), matrix.begin(), matrix.end());
    w.pushFilteredPaint(0xff2050c0, {3, filter, {-1}});
    return render(w.finish(), {}, {});
  };

  Writer plain;
  plain.push(1);
  plain.push(1);
  plain.pushAnim(0);
  plain.pushAnim(0);
  plain.pushAnim(32);
  plain.pushAnim(32);
  plain.pushPaint(0xff2050c0, false);
  auto unfiltered = render(plain.finish(), {}, {});
  CHECK(anyPixelSet(unfiltered));

  const std::vector<double> identity = {1, 0, 0, 0, 0, 0, 1, 0, 0, 0,
                                        0, 0, 1, 0, 0, 0, 0, 0, 1, 0};
  CHECK(draw(identity) == unfiltered);

  // R' = B, B' = R: a channel swap, so 0x2050c0 comes out as 0xc05020.
  const std::vector<double> swap = {0, 0, 1, 0, 0, 0, 1, 0, 0, 0,
                                    1, 0, 0, 0, 0, 0, 0, 0, 1, 0};
  auto swapped = pixelAt(draw(swap), 16, 16);
  auto source = pixelAt(unfiltered, 16, 16);
  CHECK(swapped[0] == source[2] && swapped[2] == source[0]);
  CHECK(swapped[1] == source[1]);
}

/// A blend colour filter tints the drawing without touching what is under it.
void aBlendColourFilterTints() {
  auto draw = [](bool filtered) {
    Writer w;
    w.push(1);
    w.push(1);  // Rect
    w.pushAnim(0);
    w.pushAnim(0);
    w.pushAnim(32);
    w.pushAnim(32);
    if (filtered) {
      // Opaque red, src: replaces the paint's own colour entirely.
      w.pushFilteredPaint(0xff2050c0, {3, {1, 0xffff0000, 1}, {-1}});
    } else {
      w.pushPaint(0xff2050c0, false);
    }
    return render(w.finish(), {}, {});
  };
  auto tinted = pixelAt(draw(true), 16, 16);
  CHECK(tinted[0] == 255 && tinted[1] == 0 && tinted[2] == 0);
  CHECK(draw(false) != draw(true));
}

/// A blur is an *image* filter: it grows the drawing past its own geometry.
/// Nothing but a real offscreen layer paints outside the rect, so this is the
/// observation that separates it from a colour filter.
void aBlurSpreadsPastTheGeometry() {
  auto draw = [](double sigma) {
    Writer w;
    w.push(1);
    w.push(1);  // Rect
    w.pushAnim(20);
    w.pushAnim(20);
    w.pushAnim(24);
    w.pushAnim(24);
    if (sigma <= 0) {
      w.pushPaint(0xff3366cc, false);
    } else {
      w.pushFilteredPaint(0xff3366cc, {3, {-1}, {0, sigma, sigma, 3}});
    }
    return render(w.finish(), {}, {});
  };

  auto sharp = draw(0);
  CHECK(anyPixelSet(sharp));
  // Four pixels outside the rect: untouched without the filter.
  CHECK(!opaqueAt(sharp, 14, 32));
  auto blurred = draw(6);
  CHECK(opaqueAt(blurred, 14, 32));
  // ...and the middle is still painted, so it is a blur and not a wipe.
  CHECK(opaqueAt(blurred, 32, 32));
}

/// A drop shadow paints under the content that cast it, offset by dx/dy, and
/// `shadowOnly` drops the content and keeps the shadow.
void aDropShadowPaintsUnderItsContent() {
  // A 16x16 rect at (24, 24); an unblurred black shadow 8px down and right, so
  // the shadow covers (32, 32)-(48, 48) and the content covers (24, 24)-(40, 40).
  auto draw = [](int only) {
    Writer w;
    w.push(1);
    w.push(1);  // Rect
    w.pushAnim(24);
    w.pushAnim(24);
    w.pushAnim(16);
    w.pushAnim(16);
    if (only < 0) {
      w.pushPaint(0xffffffff, false);
    } else {
      w.pushFilteredPaint(0xffffffff,
                          {3,
                           {-1},
                           {1, 8, 8, 0, 0, 0xff000000,
                            static_cast<double>(only)}});
    }
    return render(w.finish(), {}, {});
  };

  auto plain = draw(-1);
  CHECK(!opaqueAt(plain, 44, 44));  // nothing past the rect without a filter

  auto shadowed = draw(0);
  auto shadow = pixelAt(shadowed, 44, 44);
  CHECK(opaqueAt(shadowed, 44, 44));
  CHECK(shadow[0] == 0 && shadow[1] == 0 && shadow[2] == 0);
  // The content is still there, on top of its own shadow.
  auto content = pixelAt(shadowed, 28, 28);
  CHECK(content[0] == 255 && content[1] == 255 && content[2] == 255);

  auto only = draw(1);
  CHECK(opaqueAt(only, 44, 44));
  // The content it was cast from is gone, so its uncovered corner is empty.
  CHECK(!opaqueAt(only, 28, 28));
}

/// A filter must be built once, by setScene, and never again — otherwise every
/// filtered node allocates a filter per frame, which is exactly what the
/// compile-once command list exists to avoid. Counted rather than reasoned
/// about: filterBuildCount() moves on every construction, wherever it happens.
///
/// Every paint here has an animated alpha, so applyPaint really does run once
/// per node per frame. A test on static paints would pass without proving
/// anything: their compiled paint is handed over untouched, so a filter built
/// inside applyPaint would never be reached.
void filtersAreBuiltOnceAndNeverOnTheDrawPath() {
  constexpr int kNodes = 16;
  Writer w;
  w.push(kNodes);
  for (int i = 0; i < kNodes; i++) {
    w.push(1);  // Rect
    w.pushAnim(i);
    w.pushAnim(i);
    w.pushAnim(8);
    w.pushAnim(8);
    // A colour filter and an image filter on every node: two builds each.
    w.pushFilteredPaint(
        0xff3366cc,
        {24,
         {0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0},
         {0, 2, 2, 3}},
        0);
  }

  size_t before = tgfxrn::filterBuildCount();
  tgfxrn::SceneRenderer renderer;
  renderer.setScene(w.finish(), {});
  size_t afterCompile = tgfxrn::filterBuildCount();
  CHECK(afterCompile == before + 2 * kNodes);

  // Ten frames off one compile: the count must not move by one.
  for (int frame = 0; frame < 10; frame++) {
    CHECK(anyPixelSet(drawFrame(renderer, {1})));
  }
  CHECK(tgfxrn::filterBuildCount() == afterCompile);
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
  aHelperFunctionCompilesAndDoesNotCollide();
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
  aBlendModeCompositesAgainstWhatIsBelow();
  aBlendModeSurvivesAnImageFilter();
  aColourMatrixTransformsTheDrawnColour();
  aBlendColourFilterTints();
  aBlurSpreadsPastTheGeometry();
  aDropShadowPaintsUnderItsContent();
  filtersAreBuiltOnceAndNeverOnTheDrawPath();
  std::printf(failures == 0 ? "SceneTest: ok\n" : "SceneTest: %d failure(s)\n",
              failures);
  return failures == 0 ? 0 : 1;
}
