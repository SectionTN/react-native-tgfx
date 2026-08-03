// Host tests for the compiled draw program: what setScene is allowed to bake
// into a DrawCmd, and what must still be resolved every frame.
//
// Rendering goes through a real (headless Metal) GPU surface and compares
// pixels, because the invariant that matters is "the cached object draws what
// the per-frame rebuild drew", and no cheaper observation proves that.
//
// Build and run: see cpp/tests/CMakeLists.txt. The allocation cost of text is
// measured separately, in AllocBench.
#include <algorithm>
#include <array>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <span>
#include <string>
#include <utility>
#include <vector>

#include "FontRegistry.hpp"
#include "ImageRegistry.hpp"
#include "TextLayout.hpp"
#include "TgfxScene.hpp"
#include "tgfx/core/Canvas.h"
#include "tgfx/core/EncodedFormat.h"
#include "tgfx/core/ImageCodec.h"
#include "tgfx/core/ImageInfo.h"
#include "tgfx/core/Pixmap.h"
#include "tgfx/core/Surface.h"
#include "tgfx/core/Typeface.h"
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

/// The example app's bundled fonts, so the font-manager tests run against real
/// faces that live in this repo. Set by cpp/tests/CMakeLists.txt.
constexpr const char* kFontDir = TGFXRN_TEST_FONT_DIR;

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
  /// entry for the preamble when the shader declares no helper. `children` holds
  /// one shader payload per `uniform shader`, each starting with its kind.
  void pushRuntimePaint(uint32_t color, const std::vector<Uniform>& uniforms, int preamble,
                        const std::vector<int>& functions = {},
                        const std::vector<std::vector<double>>& children = {}) {
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
    push(static_cast<double>(children.size()));
    for (const auto& child : children) {
      for (double word : child) {
        push(word);
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

  /// A <CameraFrame>: no geometry of its own, then a paint, then its children.
  /// The caller pushes `childCount` nodes after this.
  void pushCameraFrame(int32_t handle, int childCount, int fit = 2,
                       int quarterTurns = 0, bool mirror = false,
                       int sampling = 1) {
    push(11);
    push(handle);
    push(fit);
    push(sampling);
    push(quarterTurns);
    push(mirror ? 1 : 0);
    pushPaint(0xffffffff, false);
    push(childCount);
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

/// 0 the text, 1 the family, 2 an empty ellipsis, 3 a two-line text.
const std::vector<std::string> kTextStrings{"Wg", "Helvetica", "", "Wg\nWg"};

/// A <Text> node body. Mirrors the Kind.Text case of writeDrawing() in
/// compile.ts: geometry, text, size, the font block, then the paragraph block.
/// The root count is the caller's, so several can be written into one program.
void writeTextNode(Writer& w, double fontSize, int fontSizeSlot, int textIndex = 0,
                   double wrapWidth = 0, int align = 0, double lineHeight = 0,
                   int weight = 400, int italic = 0) {
  w.push(8);  // Text
  w.pushAnim(4);
  w.pushAnim(44);
  w.push(textIndex);
  w.pushAnim(fontSize, fontSizeSlot);
  w.push(1);  // font family string index
  w.push(weight);
  w.push(italic);
  w.push(0);  // letterSpacing
  w.push(wrapWidth);
  w.push(align);
  w.push(lineHeight);
  w.push(0);  // maxLines
  w.push(2);  // ellipsis string index (empty)
  w.pushPaint(0xff000000, false);
}

/// One <Text> as a whole program.
void writeText(Writer& w, double fontSize, int fontSizeSlot, int textIndex = 0,
               double wrapWidth = 0, int align = 0, double lineHeight = 0, int weight = 400,
               int italic = 0) {
  w.push(1);
  writeTextNode(w, fontSize, fontSizeSlot, textIndex, wrapWidth, align, lineHeight, weight,
                italic);
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

/// `uniform shader img; main(p) { return img.eval(p); }` must draw exactly what
/// the child would have drawn on its own, and must honour the coordinate it is
/// handed rather than the fragment's own.
///
/// The child's fragment processor samples in *its* space -- a texture's
/// normalised space, only known once the texture resolves -- while the author's
/// coordinate is in the runtime shader's local space. The wrapper bridges the
/// two with an uploaded matrix, so a shifted coordinate landing on the wrong
/// texel is what a wrong (or missing) bridge looks like.
void aChildShaderSamplesWhereItIsAsked() {
  // A 2x1 image, two very different colours, repeated across a 32x32 rect, so
  // one texel of drift is a whole colour change rather than a rounding error.
  auto left = cellColor(2);
  auto right = cellColor(20);
  std::vector<uint8_t> pixels(8);
  std::copy(left.begin(), left.end(), pixels.begin());
  std::copy(right.begin(), right.end(), pixels.begin() + 4);
  auto image = registerPixels(2, 1, pixels);

  // repeat/repeat, nearest: the same child both paths draw.
  const std::vector<double> child = {7, static_cast<double>(image.handle), 1, 1, 0, 0};
  const std::vector<std::string> strings = {
      "return TGFX_CHILD_0(fragCoord);",                    // 0
      "",                                                   // 1: no preamble
      "return TGFX_CHILD_0(fragCoord + vec2(1.0, 0.0));",   // 2: shifted a texel
  };

  auto draw = [&](int body) {
    Writer w;
    w.push(1);
    w.push(1);  // Rect
    w.pushAnim(0);
    w.pushAnim(0);
    w.pushAnim(32);
    w.pushAnim(32);
    w.pushRuntimePaint(0xffffffff, {}, 1, {}, {child});
    // pushRuntimePaint writes string 0 as the body; swap it per case.
    std::vector<std::string> table = strings;
    table[0] = strings[static_cast<size_t>(body)];
    return render(w.finish(), table, {});
  };

  auto sampled = draw(0);
  CHECK(anyPixelSet(sampled));
  auto at0 = pixelAt(sampled, 0, 0);
  auto at1 = pixelAt(sampled, 1, 0);
  auto at2 = pixelAt(sampled, 2, 0);
  CHECK(at0[0] == left[0] && at0[1] == left[1]);
  CHECK(at1[0] == right[0] && at1[1] == right[1]);
  CHECK(at2[0] == left[0] && at2[1] == left[1]);

  // The same child, sampled one texel to the right: every column shifts. A
  // wrapper that ignored its argument would draw the block above again.
  auto shifted = draw(2);
  auto shifted0 = pixelAt(shifted, 0, 0);
  CHECK(shifted0[0] == right[0] && shifted0[1] == right[1]);
}

/// A child is a shader, not an image slot: a gradient has to work as one.
void aGradientChildShades() {
  // Linear black -> white across the 32-wide rect.
  const std::vector<double> child = {0, 0, 0, 32, 0, 2, 0xff000000, 0xffffffff, 0};
  const std::vector<std::string> strings = {"return TGFX_CHILD_0(fragCoord);", ""};

  Writer w;
  w.push(1);
  w.push(1);  // Rect
  w.pushAnim(0);
  w.pushAnim(0);
  w.pushAnim(32);
  w.pushAnim(32);
  w.pushRuntimePaint(0xffffffff, {}, 1, {}, {child});
  auto drawn = render(w.finish(), strings, {});
  CHECK(anyPixelSet(drawn));
  // Dark at the left end, bright at the right: the child's own coordinate ramp
  // reached it, which a child bound but never sampled would not show.
  CHECK(pixelAt(drawn, 1, 16)[0] < 40);
  CHECK(pixelAt(drawn, 30, 16)[0] > 200);
}

/// Two children on ONE shader, which is what `uniform shader a; uniform shader
/// b;` already spells and what the encoder already writes. Both wrappers land at
/// file scope in the same program, so their names have to differ per child and
/// not merely per processor -- otherwise the second redefines the first, the
/// driver rejects the whole program, and the shape paints nothing at all.
///
/// The body also samples child 0 twice, once at an offset, because the docs'
/// headline example does exactly that.
void twoChildrenOnOneShaderBothPaint() {
  // Child 0: a 2x1 image, red on the left texel and green on the right.
  auto left = cellColor(2);
  auto right = cellColor(20);
  std::vector<uint8_t> pixels(8);
  std::copy(left.begin(), left.end(), pixels.begin());
  std::copy(right.begin(), right.end(), pixels.begin() + 4);
  auto image = registerPixels(2, 1, pixels);

  const std::vector<std::vector<double>> children = {
      // repeat/repeat, nearest
      {7, static_cast<double>(image.handle), 1, 1, 0, 0},
      // Child 1: a black -> white ramp across the 32-wide rect.
      {0, 0, 0, 32, 0, 2, 0xff000000, 0xffffffff, 0},
  };
  // Child 0 twice (once shifted a texel) in the red and green channels, child 1
  // in the blue: a wrapper bound to the wrong child shows up as a wrong channel.
  const std::vector<std::string> strings{
      "return vec4(TGFX_CHILD_0(fragCoord).r, "
      "TGFX_CHILD_0(fragCoord + vec2(1.0, 0.0)).g, TGFX_CHILD_1(fragCoord).b, 1.0);",
      ""};

  Writer w;
  w.push(1);
  w.push(1);  // Rect
  w.pushAnim(0);
  w.pushAnim(0);
  w.pushAnim(32);
  w.pushAnim(32);
  w.pushRuntimePaint(0xffffffff, {}, 1, {}, children);
  auto drawn = render(w.finish(), strings, {});
  CHECK(anyPixelSet(drawn));
  // Column 0 reads child 0 at texel 0 for red and texel 1 for green, and child 1
  // near the dark end of its ramp for blue.
  auto at0 = pixelAt(drawn, 0, 16);
  CHECK(at0[0] == left[0]);
  CHECK(at0[1] == right[1]);
  CHECK(at0[2] < 40);
  // The far end only differs in blue, which is the one channel child 1 drives.
  auto at30 = pixelAt(drawn, 30, 16);
  CHECK(at30[0] == left[0]);
  CHECK(at30[2] > 200);
}

/// A child may itself be a runtime shader, which puts two runtime shader
/// processors -- and so two child wrappers -- in one compiled program. The
/// wrapper name has to be mangled per processor: two `vec4 tgfxChild(vec2)` at
/// file scope is a redefinition, the driver rejects the program, and the shape
/// does not paint at all.
void aRuntimeShaderChildNestsInOneProgram() {
  auto only = cellColor(7);
  std::vector<uint8_t> onePixel(only.begin(), only.end());
  auto image = registerPixels(1, 1, onePixel);

  const std::vector<std::string> strings = {
      "return TGFX_CHILD_0(fragCoord);",  // 0: both bodies
      "",                                 // 1: no preamble
  };
  // The inner runtime shader, as a child payload: body, preamble, no functions,
  // no uniforms, one child of its own.
  const std::vector<double> inner = {6, 0, 1, 0, 0, 1,
                                     7, static_cast<double>(image.handle), 0, 0, 0, 0};

  Writer w;
  w.push(1);
  w.push(1);  // Rect
  w.pushAnim(0);
  w.pushAnim(0);
  w.pushAnim(32);
  w.pushAnim(32);
  w.pushRuntimePaint(0xffffffff, {}, 1, {}, {inner});
  auto drawn = render(w.finish(), strings, {});
  auto middle = pixelAt(drawn, 16, 16);
  CHECK(middle[0] == only[0] && middle[1] == only[1]);
}

/// Two runtime shaders with children in one scene: the child indices and the
/// mangled wrapper names are per processor, so neither may reach the other's
/// child. One body, two children -- only the binding tells the draws apart.
void twoShadersWithChildrenDoNotCollide() {
  auto first = cellColor(3);
  auto second = cellColor(30);
  std::vector<uint8_t> onePixel(4);
  std::copy(first.begin(), first.end(), onePixel.begin());
  auto imageA = registerPixels(1, 1, onePixel);
  std::copy(second.begin(), second.end(), onePixel.begin());
  auto imageB = registerPixels(1, 1, onePixel);

  const std::vector<std::string> strings = {"return TGFX_CHILD_0(fragCoord);", ""};
  Writer w;
  w.push(2);
  for (auto handle : {imageA.handle, imageB.handle}) {
    w.push(1);  // Rect
    w.pushAnim(handle == imageA.handle ? 0 : 32);
    w.pushAnim(0);
    w.pushAnim(32);
    w.pushAnim(32);
    w.pushRuntimePaint(0xffffffff, {}, 1, {},
                       {{7, static_cast<double>(handle), 0, 0, 0, 0}});
  }
  auto drawn = render(w.finish(), strings, {});
  auto onLeft = pixelAt(drawn, 16, 16);
  auto onRight = pixelAt(drawn, 48, 16);
  CHECK(onLeft[0] == first[0] && onLeft[1] == first[1]);
  CHECK(onRight[0] == second[0] && onRight[1] == second[1]);
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

/// The #132 seam: a runtime shader whose child is an <ImageShader> on an
/// external (hardware-buffer) handle. The buffer is re-pointed from C++ with no
/// re-commit, so the child cannot be baked at setScene -- and the compiled
/// program stays the same one, because what a texture holds is not part of its
/// key. One setScene, two frames, two different images.
void anExternalHandleDrivesAChildShaderPerFrame() {
  auto& registry = tgfxrn::ImageRegistry::instance();
  auto first = registerSolid(cellColor(11), 32, 32);
  auto second = registerSolid(cellColor(27), 32, 32);
  auto external = registry.addExternal(registry.acquire(first.handle));
  CHECK(external.handle != 0);

  const std::vector<std::string> strings = {"return TGFX_CHILD_0(fragCoord);", ""};
  Writer w;
  w.push(1);
  w.push(1);  // Rect
  w.pushAnim(0);
  w.pushAnim(0);
  w.pushAnim(32);
  w.pushAnim(32);
  w.pushRuntimePaint(0xffffffff, {}, 1, {},
                     {{7, static_cast<double>(external.handle), 0, 0, 0, 0}});
  tgfxrn::SceneRenderer renderer;
  renderer.setScene(w.finish(), strings);

  auto expectedFirst = cellColor(11);
  auto before = pixelAt(drawFrame(renderer, {}), 16, 16);
  CHECK(before[0] == expectedFirst[0] && before[1] == expectedFirst[1]);

  CHECK(registry.replaceExternal(external.handle, registry.acquire(second.handle)));
  auto expectedSecond = cellColor(27);
  auto after = pixelAt(drawFrame(renderer, {}), 16, 16);
  CHECK(after[0] == expectedSecond[0] && after[1] == expectedSecond[1]);
  registry.remove(external.handle);
}

/// <CameraFrame> (#132): the frame becomes an ordinary scene input, and the
/// scene draws over it.
///
/// The property under test is the one the native-only camera path had and this
/// must not lose: the frame and its children go through the *same* matrix, so
/// an overlay in frame pixels cannot drift from the image. A 32x32 frame
/// covering a 64x64 canvas is scaled 2x, so a 16x16 child at the frame's origin
/// has to land on a 32x32 canvas quadrant — which is only true if it rode the
/// frame's transform rather than being drawn in canvas coordinates.
void aCameraFrameCoversTheCanvasAndItsChildrenRideItsTransform() {
  auto& registry = tgfxrn::ImageRegistry::instance();
  auto frame = registerSolid(cellColor(7), 32, 32);
  auto next = registerSolid(cellColor(23), 32, 32);
  auto external = registry.addExternal(registry.acquire(frame.handle));
  CHECK(external.handle != 0);

  Writer w;
  w.push(1);
  w.pushCameraFrame(external.handle, 1);
  w.push(1);  // Rect, in frame pixels
  w.pushAnim(0);
  w.pushAnim(0);
  w.pushAnim(16);
  w.pushAnim(16);
  w.pushPaint(0xff0000ff, false);
  tgfxrn::SceneRenderer renderer;
  renderer.setScene(w.finish(), {});

  auto first = cellColor(7);
  auto pixels = drawFrame(renderer, {});
  // The 16x16 child fills the top-left 32x32 of the canvas: same matrix.
  auto overlay = pixelAt(pixels, 8, 8);
  CHECK(overlay[0] == 0 && overlay[2] == 255);
  CHECK(!(pixelAt(pixels, 40, 8)[2] == 255));
  // ...and the frame covers everything the child does not.
  auto uncovered = pixelAt(pixels, 48, 48);
  CHECK(uncovered[0] == first[0] && uncovered[1] == first[1]);

  // A new buffer behind the same handle, with no re-commit: the draw path has
  // to re-read it, and the overlay must not move.
  CHECK(registry.replaceExternal(external.handle, registry.acquire(next.handle)));
  auto second = cellColor(23);
  pixels = drawFrame(renderer, {});
  auto swapped = pixelAt(pixels, 48, 48);
  CHECK(swapped[0] == second[0] && swapped[1] == second[1]);
  auto stillThere = pixelAt(pixels, 8, 8);
  CHECK(stillThere[0] == 0 && stillThere[2] == 255);

  registry.remove(external.handle);
}

/// Mirroring and rotation are part of that shared matrix, not a separate
/// correction applied to the image alone — so they move the overlay with the
/// frame. A selfie frame drawn un-mirrored is the "my face is the wrong way
/// round" bug; an overlay that stays put while the frame flips is the drift the
/// shared matrix exists to prevent.
/// Which corner of the canvas a child at the frame's origin lands in, under one
/// (rotation, mirror) pair. `frameW`/`frameH` size the frame; the child is a
/// quarter of it, so the answer is a corner whatever the frame's aspect is.
///
/// Returned as {topLeft, topRight, bottomLeft, bottomRight}.
std::array<bool, 4> cameraFrameChildCorner(int32_t handle, int frameW, int frameH,
                                           int quarterTurns, bool mirror) {
  Writer w;
  w.push(1);
  w.pushCameraFrame(handle, 1, 2, quarterTurns, mirror);
  w.push(1);  // Rect, in frame pixels
  w.pushAnim(0);
  w.pushAnim(0);
  w.pushAnim(frameW / 2);
  w.pushAnim(frameH / 2);
  w.pushPaint(0xff0000ff, false);
  auto pixels = render(w.finish(), {}, {});
  return {pixelAt(pixels, 8, 8)[2] == 255, pixelAt(pixels, 56, 8)[2] == 255,
          pixelAt(pixels, 8, 56)[2] == 255, pixelAt(pixels, 56, 56)[2] == 255};
}

constexpr std::array<bool, 4> kTopLeft{true, false, false, false};
constexpr std::array<bool, 4> kTopRight{false, true, false, false};
constexpr std::array<bool, 4> kBottomLeft{false, false, true, false};
constexpr std::array<bool, 4> kBottomRight{false, false, false, true};

void aCameraFrameMirrorsAndRotatesItsChildrenWithTheFrame() {
  auto& registry = tgfxrn::ImageRegistry::instance();
  auto frame = registerSolid(cellColor(7), 32, 32);
  auto external = registry.addExternal(registry.acquire(frame.handle));

  // The same 16x16 child at the frame's origin, under each transform.
  auto quadrant = [&](int quarterTurns, bool mirror) {
    return cameraFrameChildCorner(external.handle, 32, 32, quarterTurns, mirror);
  };

  CHECK(quadrant(0, false) == kTopLeft);
  // Flipped along the vertical axis: top-left becomes top-right.
  CHECK(quadrant(0, true) == kTopRight);
  // A quarter turn clockwise carries it round the canvas.
  CHECK(quadrant(1, false) == kTopRight);
  CHECK(quadrant(2, false) == kBottomRight);
  CHECK(quadrant(3, false) == kBottomLeft);
  registry.remove(external.handle);
}

/// The same four turns on a frame that is **not square**, which is the only
/// shape a camera actually produces.
///
/// A square frame cannot see this: with `w == h`, `postTranslate(h, 0)` and
/// `postTranslate(0, w)` are the same call, and the `ow`/`oh` swap that feeds
/// the fit is a no-op — so the rotation maths can be wrong in two independent
/// places and every square case still passes. 32x16 separates them: an odd
/// quarter turn makes the frame 16 wide and 32 tall, which changes the cover
/// scale (max(64/16, 64/32) = 4, against 2 for the even turns) as well as the
/// slide-back offset.
void aCameraFrameRotatesANonSquareFrame() {
  auto& registry = tgfxrn::ImageRegistry::instance();
  auto frame = registerSolid(cellColor(7), 32, 16);
  auto external = registry.addExternal(registry.acquire(frame.handle));

  auto quadrant = [&](int quarterTurns) {
    return cameraFrameChildCorner(external.handle, 32, 16, quarterTurns, false);
  };

  CHECK(quadrant(0) == kTopLeft);
  // turns=1: the 16x8 child maps to x in [8,16], y in [0,16] of the 16x32
  // rotated frame; cover scale 4 and a -32 y offset put it at x in [32,64],
  // y in [-32,32] — the top-right corner.
  CHECK(quadrant(1) == kTopRight);
  CHECK(quadrant(2) == kBottomRight);
  CHECK(quadrant(3) == kBottomLeft);
  // Mirroring is still a flip about the frame's own vertical axis, and the
  // frame's width is 32 here where the rotated height is 16 — using the wrong
  // one puts the child off-canvas rather than in the opposite corner.
  CHECK(cameraFrameChildCorner(external.handle, 32, 16, 0, true) == kTopRight);
  registry.remove(external.handle);
}

/// A non-square frame is centre-cropped by `cover` — it is scaled to fill the
/// canvas and the overflowing axis runs off it, rather than being letterboxed.
/// The old native-only path hardcoded exactly this (`max(sw/fw, sh/fh)`), so it
/// is the behaviour a camera scene has to keep by default.
void aCameraFrameCoverCropsTheOverflowingAxis() {
  auto& registry = tgfxrn::ImageRegistry::instance();
  // 32x16: twice as wide as it is tall, on a square canvas.
  auto wide = registerSolid(cellColor(7), 32, 16);
  auto external = registry.addExternal(registry.acquire(wide.handle));

  Writer w;
  w.push(1);
  w.pushCameraFrame(external.handle, 0);
  auto pixels = render(w.finish(), {}, {});
  // scale = max(64/32, 64/16) = 4, so the frame is 128x64: every corner covered.
  auto expected = cellColor(7);
  for (auto [x, y] : {std::pair{1, 1}, {62, 1}, {1, 62}, {62, 62}}) {
    auto pixel = pixelAt(pixels, x, y);
    CHECK(pixel[0] == expected[0] && pixel[1] == expected[1]);
  }
  registry.remove(external.handle);
}

/// A handle with no frame behind it yet draws nothing at all — children
/// included. There is no frame to place them against, and an overlay floating
/// over a black canvas at the wrong scale is worse than an empty one.
void aCameraFrameWithNoFrameDrawsNothing() {
  Writer w;
  w.push(1);
  w.pushCameraFrame(0, 1);
  w.push(1);  // Rect
  w.pushAnim(0);
  w.pushAnim(0);
  w.pushAnim(16);
  w.pushAnim(16);
  w.pushPaint(0xff0000ff, false);
  auto pixels = render(w.finish(), {}, {});
  CHECK(!opaqueAt(pixels, 8, 8));
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

// ---------------- text ----------------

/// The rightmost column holding ink, or -1 when nothing was drawn.
int rightmostInk(const Pixels& pixels) {
  int rightmost = -1;
  for (int y = 0; y < kHeight; y++) {
    for (int x = 0; x < kWidth; x++) {
      if (pixels[static_cast<size_t>((y * kWidth + x) * 4 + 3)] != 0) {
        rightmost = std::max(rightmost, x);
      }
    }
  }
  return rightmost;
}

int inkRows(const Pixels& pixels) {
  int rows = 0;
  for (int y = 0; y < kHeight; y++) {
    for (int x = 0; x < kWidth; x++) {
      if (pixels[static_cast<size_t>((y * kWidth + x) * 4 + 3)] != 0) {
        rows++;
        break;
      }
    }
  }
  return rows;
}

/// The acceptance case the old code could not meet: an Android image with none
/// of Roboto-Regular.ttf, NotoSans-Regular.ttf or DroidSans.ttf. Those three
/// paths were the only resolution that could ever succeed there — MakeFromName
/// is nullptr on FreeType — so such a device drew no text at all.
void aFontIsFoundOnAnImageWithNoneOfTheOldHardcodedPaths() {
  auto best = [](const std::vector<std::string>& files, const std::string& family, int weight,
                 bool italic) {
    auto ranked = tgfxrn::rankFontFiles(files, family, weight, italic);
    return ranked.empty() ? -1 : ranked.front();
  };
  const std::vector<std::string> oemImage{
      "/system/fonts/NotoColorEmoji.ttf",
      "/system/fonts/SamsungOne-400.ttf",
      "/system/fonts/SamsungOne-700.ttf",
      "/system/fonts/SamsungSharpSans-Bold.ttf",
  };
  CHECK(best(oemImage, "", 400, false) >= 0);
  // Never the emoji font: that is how a paragraph renders as blank boxes.
  CHECK(best(oemImage, "", 400, false) != 0);
  // Weight steers the choice inside what the image actually has.
  CHECK(best(oemImage, "", 700, false) != best(oemImage, "", 400, false));

  // An asked-for family beats every default, even an unstyled match.
  const std::vector<std::string> withFamily{"/system/fonts/Roboto-Regular.ttf",
                                            "/system/fonts/PlayfairDisplay-Regular.ttf"};
  CHECK(best(withFamily, "Playfair Display", 400, false) == 1);
  CHECK(best(withFamily, "playfair-display", 400, false) == 1);
  // Nothing but an emoji font is still nothing.
  CHECK(tgfxrn::rankFontFiles({"/system/fonts/NotoColorEmoji.ttf"}, "", 400, false).empty());

  // Every plausible candidate is offered, best first, because a filename says
  // nothing about coverage. On a real Samsung image the top-scoring bold face is
  // NotoSansCham-Bold, which has no Latin at all — resolution has to be able to
  // walk past it instead of giving up, which is what left bold text blank.
  const std::vector<std::string> samsung{
      "/system/fonts/DroidSans-Bold.ttf", "/system/fonts/NotoColorEmoji.ttf",
      "/system/fonts/NotoSansCham-Bold.ttf", "/system/fonts/Roboto-Regular.ttf"};
  auto ranked = tgfxrn::rankFontFiles(samsung, "", 700, false);
  CHECK(ranked.size() >= 3);
  CHECK(std::find(ranked.begin(), ranked.end(), 0) != ranked.end());
  // The emoji font is still never offered.
  CHECK(std::find(ranked.begin(), ranked.end(), 1) == ranked.end());

  // A *named* family must not promote a special-purpose face either: "Noto"
  // prefix-matches NotoColorEmoji, which would otherwise outrank every real
  // text face and draw the paragraph as .notdef.
  const std::vector<std::string> noto{"/system/fonts/NotoColorEmoji.ttf",
                                      "/system/fonts/SamsungOne-400.ttf"};
  CHECK(best(noto, "Noto", 400, false) == 1);
  CHECK(tgfxrn::rankFontFiles(noto, "Noto", 400, false).size() == 1);
  // Unless it is asked for by name, in which case it is the only answer.
  CHECK(best(noto, "Noto Color Emoji", 400, false) == 0);
}

/// The path cache is shared with the fallback chain, which files the colour
/// emoji face by path. A hit has to clear the same bar a fresh open does, or
/// resolution returns a different face depending on whether an emoji was drawn
/// first — the same input, two answers.
void aCachedFaceStillHasToBeAbleToDrawText() {
  auto& registry = tgfxrn::FontRegistry::instance();
  registry.clear();
  // Warms files_ with whatever colour-emoji face this host has.
  auto fallbacks = registry.fallbacks();
  CHECK(!fallbacks.empty());
  for (const auto& typeface : fallbacks) {
    CHECK(typeface->getGlyphID('A') == 0);
  }
  // Every resolution after that still has to land on a face that can draw.
  for (const char* family : {"", "Noto", "Apple Color Emoji", "No Such Family"}) {
    auto match = registry.match(family, 400, false);
    CHECK(match.typeface != nullptr);
    if (match.typeface != nullptr) {
      CHECK(match.typeface->getGlyphID('A') != 0);
    }
  }
  registry.clear();
}

/// <Text> with no fontFamily at all has to resolve to something that can draw
/// Latin. CoreText answers a descriptor naming no family with *a* font, and the
/// one it picks has no Latin glyphs — every unstyled label renders blank.
void theDefaultFamilyCanActuallyDrawText() {
  auto& registry = tgfxrn::FontRegistry::instance();
  registry.clear();
  auto fallback = registry.match("", 400, false);
  CHECK(fallback.typeface != nullptr);
  if (fallback.typeface != nullptr) {
    CHECK(fallback.typeface->getGlyphID('A') != 0);
    CHECK(fallback.typeface->getGlyphID('0') != 0);
  }
  // A family nothing has must land on the same drawable default.
  auto unknown = registry.match("No Such Family At All", 400, false);
  CHECK(unknown.typeface != nullptr && unknown.typeface->getGlyphID('A') != 0);

  // And it has to reach the draw, not just the match.
  Writer w;
  writeText(w, 24, -1, 0);
  CHECK(anyPixelSet(render(w.finish(), {"Wg", "", ""}, {})));
}

/// loadFont() is a bare promise: no state change, no commit, nothing else to
/// wake the render loop. Registering a face has to schedule the draw itself, or
/// text stays in the platform fallback for the life of the process.
void aFontRegistrationSchedulesADraw() {
  auto& registry = tgfxrn::FontRegistry::instance();
  registry.clear();
  int wakes = 0;
  auto token = tgfxrn::ImageRegistry::instance().addWakeListener([&] { wakes++; });
  uint64_t before = registry.epoch();

  registry.add(tgfx::Typeface::MakeFromPath(std::string(kFontDir) + "/PT_Serif-Web-Regular.ttf"),
               "Wake Serif");
  CHECK(wakes == 1);
  CHECK(registry.epoch() > before);

  // A registration that fails registers nothing and wakes nobody.
  registry.add(nullptr, "Wake Serif");
  CHECK(wakes == 1);

  tgfxrn::ImageRegistry::instance().removeWakeListener(token);
  registry.add(tgfx::Typeface::MakeFromPath(std::string(kFontDir) + "/PT_Serif-Web-Bold.ttf"),
               "Wake Serif");
  CHECK(wakes == 1);
  registry.clear();
}

/// Why the wake alone is not enough: the layout is memoised per command, so a
/// face that lands after the scene compiled is only picked up by recompiling
/// the same program. Re-running setScene on identical words has to change what
/// is drawn.
void recompilingAfterARegistrationPicksUpTheNewFace() {
  auto& registry = tgfxrn::FontRegistry::instance();
  registry.clear();
  const std::vector<std::string> strings{"Wg", "Late Serif", ""};
  Writer w;
  writeText(w, 28, -1, 0);
  auto words = w.finish();

  tgfxrn::SceneRenderer renderer;
  renderer.setScene(words, strings);
  auto fallback = drawFrame(renderer, {});
  CHECK(anyPixelSet(fallback));

  registry.add(tgfx::Typeface::MakeFromPath(std::string(kFontDir) + "/PT_Serif-Web-Bold.ttf"),
               "Late Serif");
  // A redraw alone replays the memoised layout — same pixels.
  CHECK(drawFrame(renderer, {}) == fallback);
  // The recompile is what re-resolves the typeface.
  renderer.setScene(words, strings);
  CHECK(drawFrame(renderer, {}) != fallback);
  registry.clear();
}

/// The registered face has to win over the system one, and fontWeight has to
/// pick between the faces of a family rather than "whatever loads".
void aRegisteredFamilyMatchesByWeightAndStyle() {
  auto& registry = tgfxrn::FontRegistry::instance();
  registry.clear();
  auto regular = tgfx::Typeface::MakeFromPath(std::string(kFontDir) + "/PT_Serif-Web-Regular.ttf");
  auto bold = tgfx::Typeface::MakeFromPath(std::string(kFontDir) + "/PT_Serif-Web-Bold.ttf");
  auto italic = tgfx::Typeface::MakeFromPath(std::string(kFontDir) + "/PT_Serif-Web-Italic.ttf");
  CHECK(regular != nullptr && bold != nullptr && italic != nullptr);
  if (regular == nullptr || bold == nullptr || italic == nullptr) {
    return;
  }
  // The weight and slant come from the font's own OS/2 table, not the caller.
  CHECK(tgfxrn::readFaceStyle(regular).weight == 400);
  CHECK(tgfxrn::readFaceStyle(bold).weight >= 700);
  CHECK(!tgfxrn::readFaceStyle(regular).italic);
  CHECK(tgfxrn::readFaceStyle(italic).italic);

  uint64_t before = registry.epoch();
  CHECK(registry.add(regular, "Demo Serif") == "Demo Serif");
  registry.add(bold, "Demo Serif");
  registry.add(italic, "Demo Serif");
  // The epoch has to move, or a scene committed before the load skips its
  // recompile and keeps drawing in the fallback face forever.
  CHECK(registry.epoch() > before);

  CHECK(registry.match("Demo Serif", 400, false).typeface == regular);
  CHECK(registry.match("Demo Serif", 700, false).typeface == bold);
  CHECK(registry.match("Demo Serif", 500, false).typeface == regular);
  CHECK(registry.match("Demo Serif", 400, true).typeface == italic);
  // Folded: spelling the family differently must not miss it.
  CHECK(registry.match("demoserif", 700, false).typeface == bold);
  // A weight no face covers is synthesised rather than dropped.
  auto black = registry.match("Demo Serif", 900, false);
  CHECK(black.typeface == bold && black.fauxBold);
  // An unregistered family still resolves to something drawable.
  CHECK(registry.match("Nothing By This Name", 400, false).typeface != nullptr);
  registry.clear();
}

/// The registered family has to reach the draw, and bold has to look different
/// from regular — the whole point of fontWeight.
void aRegisteredFontDrawsAndBoldDiffersFromRegular() {
  auto& registry = tgfxrn::FontRegistry::instance();
  registry.clear();
  registry.add(tgfx::Typeface::MakeFromPath(std::string(kFontDir) + "/PT_Serif-Web-Regular.ttf"),
               "Demo Serif");
  registry.add(tgfx::Typeface::MakeFromPath(std::string(kFontDir) + "/PT_Serif-Web-Bold.ttf"),
               "Demo Serif");
  const std::vector<std::string> strings{"Wg", "Demo Serif", ""};

  Writer regular;
  writeText(regular, 28, -1, 0, 0, 0, 0, 400, 0);
  Writer bold;
  writeText(bold, 28, -1, 0, 0, 0, 0, 700, 0);
  auto regularPixels = render(regular.finish(), strings, {});
  auto boldPixels = render(bold.finish(), strings, {});
  CHECK(anyPixelSet(regularPixels));
  CHECK(regularPixels != boldPixels);

  // And it is really the registered face: the system's Helvetica draws
  // something else entirely.
  Writer system;
  writeText(system, 28, -1, 0, 0, 0, 0, 400, 0);
  CHECK(render(system.finish(), {"Wg", "Helvetica", ""}, {}) != regularPixels);
  registry.clear();
}

/// Wrapping, alignment and line height are the three things a single
/// drawSimpleText call could not do at all.
void aParagraphWrapsAlignsAndStacks() {
  tgfxrn::FontRegistry::instance().clear();
  const std::vector<std::string> strings{"one two three four", "Helvetica", ""};

  Writer unwrapped;
  writeText(unwrapped, 10, -1, 0, 0, 0, 0);
  Writer wrapped;
  writeText(wrapped, 10, -1, 0, 40, 0, 0);
  auto flat = render(unwrapped.finish(), strings, {});
  auto stacked = render(wrapped.finish(), strings, {});
  CHECK(anyPixelSet(flat));
  CHECK(inkRows(stacked) > inkRows(flat));
  CHECK(rightmostInk(stacked) < rightmostInk(flat));

  // Alignment moves the short lines, so it cannot be a no-op.
  Writer right;
  writeText(right, 10, -1, 0, 40, 2, 0);
  CHECK(render(right.finish(), strings, {}) != stacked);

  // A larger line height spreads the same lines further apart. Measured rather
  // than drawn: at 24 px apart the later baselines fall off a 64 px canvas, so
  // pixels would report the clip, not the spacing.
  tgfxrn::TextSpec spec;
  spec.family = "Helvetica";
  spec.wrapWidth = 40;
  auto natural = tgfxrn::layoutText("one two three four", spec, 10);
  spec.lineHeight = 24;
  auto tall = tgfxrn::layoutText("one two three four", spec, 10);
  CHECK(natural.metrics.lineCount == tall.metrics.lineCount);
  CHECK(tall.metrics.height > natural.metrics.height);
}

/// An explicit \n has to break the line even with no wrap width.
void anExplicitNewlineBreaksTheLine() {
  tgfxrn::FontRegistry::instance().clear();
  const std::vector<std::string> strings{"Wg", "Helvetica", "", "Wg\nWg"};
  Writer single;
  writeText(single, 12, -1, 0);
  Writer two;
  writeText(two, 12, -1, 3);
  CHECK(inkRows(render(two.finish(), strings, {})) >
        inkRows(render(single.finish(), strings, {})));
}

/// measureText has to describe the text that is actually drawn, or it is worse
/// than no measurement at all.
void theMeasuredWidthIsTheDrawnWidth() {
  tgfxrn::FontRegistry::instance().clear();
  tgfxrn::TextSpec spec;
  spec.family = "Helvetica";
  auto measured = tgfxrn::layoutText("Wg", spec, 24);
  CHECK(measured.blob != nullptr);
  CHECK(measured.metrics.width > 0);
  CHECK(measured.metrics.lineCount == 1);

  // Drawn from x = 0: every inked column has to fall inside the measured width,
  // and the ink has to reach most of the way across it.
  Writer w;
  w.push(1);
  w.push(8);
  w.pushAnim(0);
  w.pushAnim(40);
  w.push(0);
  w.pushAnim(24);
  w.push(1);
  w.push(400);
  w.push(0);
  w.push(0);
  w.push(0);
  w.push(0);
  w.push(0);
  w.push(0);
  w.push(2);
  w.pushPaint(0xff000000, false);
  auto ink = rightmostInk(render(w.finish(), {"Wg", "Helvetica", ""}, {}));
  CHECK(ink >= 0);
  CHECK(static_cast<float>(ink) <= measured.metrics.width);
  CHECK(static_cast<float>(ink) > measured.metrics.width * 0.7f);

  // Wrapping reports the lines it produced.
  spec.wrapWidth = 40;
  auto wrapped = tgfxrn::layoutText("one two three four", spec, 12);
  CHECK(wrapped.metrics.lineCount > 1);
  CHECK(wrapped.metrics.width <= 40);
  CHECK(wrapped.metrics.height > wrapped.metrics.descent - wrapped.metrics.ascent);

  // maxLines truncates, and the ellipsis stays inside the box.
  spec.maxLines = 1;
  spec.ellipsis = "...";
  auto clipped = tgfxrn::layoutText("one two three four", spec, 12);
  CHECK(clipped.metrics.lineCount == 1);
  CHECK(clipped.metrics.width <= 40);
}

/// The layout is cached by rounded size: two sizes inside one quarter-pixel
/// share a blob, a real change builds a new one. Without that, an animated
/// fontSize allocates a ScalerContext under a global lock on every frame and
/// grows a map tgfx never erases.
void theLayoutIsCachedByQuantisedSize() {
  tgfxrn::FontRegistry::instance().clear();
  tgfxrn::TextCmd cmd;
  cmd.text = "Wg";
  cmd.spec.family = "Helvetica";
  auto at20 = cmd.resolve(20).blob;
  CHECK(at20 != nullptr);
  CHECK(cmd.resolve(20.1f).blob == at20);
  CHECK(cmd.resolve(20).blob == at20);
  CHECK(cmd.resolve(24).blob != at20);
}

/// A codepoint the primary face has no glyph for must reach a fallback. The old
/// path dropped glyph 0 inside TextBlob::MakeFrom and left a blank gap with no
/// warning, which is how emoji "worked".
void anEmojiFallsBackInsteadOfVanishing() {
  tgfxrn::FontRegistry::instance().clear();
  const std::vector<std::string> strings{"\xF0\x9F\x98\x80", "Helvetica", ""};
  Writer w;
  writeText(w, 28, -1, 0);
  auto pixels = render(w.finish(), strings, {});
  // Not conditional: this host always has Apple Color Emoji, so an empty chain
  // is a regression rather than an environment, and a skip here would be a test
  // that cannot fail.
  CHECK(!tgfxrn::FontRegistry::instance().fallbacks().empty());
  CHECK(anyPixelSet(pixels));
}

/// <TextPath> has to bend the run: the same string on a curve cannot be the
/// same pixels as the flat one.
void textOnAPathFollowsTheCurve() {
  tgfxrn::FontRegistry::instance().clear();
  const std::vector<std::string> strings{"M4 40 q28 -32 56 0", "curve", "Helvetica"};
  Writer w;
  w.push(1);
  w.push(10);  // TextPath
  w.push(0);   // path
  w.push(1);   // text
  w.pushAnim(12);
  w.push(2);  // family
  w.push(400);
  w.push(0);
  w.push(0);
  w.push(0);  // startOffset
  w.pushPaint(0xff000000, false);
  auto curved = render(w.finish(), strings, {});
  CHECK(anyPixelSet(curved));

  // The same string, same size, drawn flat.
  Writer flat;
  writeText(flat, 12, -1, 0);
  CHECK(render(flat.finish(), {"curve", "Helvetica", ""}, {}) != curved);
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
  aChildShaderSamplesWhereItIsAsked();
  aGradientChildShades();
  twoChildrenOnOneShaderBothPaint();
  aRuntimeShaderChildNestsInOneProgram();
  twoShadersWithChildrenDoNotCollide();
  fillCoversTheWholeCanvas();
  everyImageDrawsItsOwnHandle();
  reCommittingAnImageSceneDecodesNothing();
  theByteBudgetEvictsLeastRecentlyUsed();
  fitModesLetterboxAndCrop();
  aSourceRectPicksOneSprite();
  anImageShaderTilesAcrossAShape();
  anExternalHandleIsReplacedInPlaceAndNotBudgeted();
  anExternalHandleAlsoDrivesAnImageShaderPerFrame();
  anExternalHandleDrivesAChildShaderPerFrame();
  aCameraFrameCoversTheCanvasAndItsChildrenRideItsTransform();
  aCameraFrameMirrorsAndRotatesItsChildrenWithTheFrame();
  aCameraFrameRotatesANonSquareFrame();
  aCameraFrameCoverCropsTheOverflowingAxis();
  aCameraFrameWithNoFrameDrawsNothing();
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
  aFontIsFoundOnAnImageWithNoneOfTheOldHardcodedPaths();
  theDefaultFamilyCanActuallyDrawText();
  aCachedFaceStillHasToBeAbleToDrawText();
  aFontRegistrationSchedulesADraw();
  recompilingAfterARegistrationPicksUpTheNewFace();
  aRegisteredFamilyMatchesByWeightAndStyle();
  aRegisteredFontDrawsAndBoldDiffersFromRegular();
  aParagraphWrapsAlignsAndStacks();
  anExplicitNewlineBreaksTheLine();
  theMeasuredWidthIsTheDrawnWidth();
  theLayoutIsCachedByQuantisedSize();
  anEmojiFallsBackInsteadOfVanishing();
  textOnAPathFollowsTheCurve();
  std::printf(failures == 0 ? "SceneTest: ok\n" : "SceneTest: %d failure(s)\n",
              failures);
  return failures == 0 ? 0 : 1;
}
