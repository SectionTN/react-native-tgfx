// Host tests for the compiled draw program, through a real headless Metal surface.
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <span>
#include <string>
#include <utility>
#include <vector>

#include "FontRegistry.hpp"
#include "ImageRegistry.hpp"
#include "TextLayout.hpp"
#include "SvgImage.hpp"
#include "PathOps.hpp"
#include "SvgPath.hpp"
#include "TgfxScene.hpp"
#include "tgfx/core/Canvas.h"
#include "tgfx/core/Data.h"
#include "tgfx/core/EncodedFormat.h"
#include "tgfx/core/Image.h"
#include "tgfx/core/ImageCodec.h"
#include "tgfx/core/ImageInfo.h"
#include "core/codecs/jpeg/JpegCodec.h"
#include "tgfx/core/Orientation.h"
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

tgfxrn::TextRun run(std::string text) {
  tgfxrn::TextRun out;
  out.text = std::move(text);
  return out;
}

constexpr int kWidth = 64;
constexpr int kHeight = 64;

/// The example app's bundled fonts, set by cpp/tests/CMakeLists.txt.
constexpr const char* kFontDir = TGFXRN_TEST_FONT_DIR;

/// Mirrors src/compiler/writer.ts: header, node stream, then the patch table.
struct Writer {
  std::vector<double> words{0, 0, 0};
  std::vector<double> patches;

  void push(double value) {
    words.push_back(value);
  }

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

  void pushLiveColorPaint(uint32_t color,
                          const std::array<std::pair<double, int>, 4>& rgba) {
    push(color);
    push(2 | 8);
    for (const auto& channel : rgba) {
      pushAnim(channel.first, channel.second);
    }
    pushAnim(1);  // strokeWidth
    push(0);
    push(0);
    pushAnim(1);  // alpha
    push(-1);     // no shader
  }

  struct Filters {
    int blend = 3;  // SrcOver
    std::vector<double> colorFilter{-1};
    std::vector<double> imageFilter{-1};
  };

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

  struct Uniform {
    int name;
    std::vector<std::pair<double, int>> components;
  };

  /// A runtime-shader paint. Strings: 0 = body, then names; `children` is one payload per child.
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

  /// An image node, mirroring writeDrawing() in compile.ts.
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

  /// A <CameraFrame>: paint, then `childCount` nodes the caller pushes after this.
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

/// Draw one frame of an already-compiled program, so a test can prove what a *second* frame does.
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

std::array<uint8_t, 4> cellColor(int index) {
  return {static_cast<uint8_t>(10 + index * 6),
          static_cast<uint8_t>(200 - index * 4),
          static_cast<uint8_t>(60 + index * 3), 255};
}

/// Encode as PNG and register it the way the TgfxImage hybrid object does. Returns the handle.
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

tgfxrn::ImageHandle registerSolid(const std::array<uint8_t, 4>& rgba,
                                  int width = 2, int height = 2) {
  std::vector<uint8_t> pixels(static_cast<size_t>(width) * height * 4);
  for (size_t i = 0; i < pixels.size(); i += 4) {
    std::copy(rgba.begin(), rgba.end(), pixels.begin() + static_cast<long>(i));
  }
  return registerPixels(width, height, pixels);
}

std::array<uint8_t, 3> pixelAt(const Pixels& pixels, int x, int y) {
  size_t at = (static_cast<size_t>(y) * kWidth + static_cast<size_t>(x)) * 4;
  return {pixels[at], pixels[at + 1], pixels[at + 2]};
}

bool opaqueAt(const Pixels& pixels, int x, int y) {
  return pixels[(static_cast<size_t>(y) * kWidth + static_cast<size_t>(x)) * 4 + 3] > 0;
}

std::vector<double> oneRect() {
  Writer w;
  w.push(1);
  w.push(1);  // Rect
  w.pushAnim(8);
  w.pushAnim(8);
  w.pushAnim(40);
  w.pushAnim(40);
  w.pushPaint(0xff3366cc, false);
  return w.finish();
}

/// A corrupt program must be rejected without first trusting its counts: a regression here is an OOM.
void aCorruptProgramIsRejectedWithoutTrustingItsCounts() {
  auto valid = oneRect();
  CHECK(anyPixelSet(render(valid, {}, {})));

  const double kHuge = 2147483647.0;
  const double kNan = std::nan("");
  std::vector<std::vector<double>> corrupt;
  auto rootCount = valid;
  rootCount[3] = kHuge;
  corrupt.push_back(rootCount);
  Writer group;
  group.push(1);
  group.push(0);  // Group
  group.push(0);  // no transform ops
  group.push(kHuge);
  corrupt.push_back(group.finish());
  // The header's own words: a NaN or negative length is not a size_t.
  for (double bad : {kNan, -1.0, 1e300}) {
    auto header = valid;
    header[1] = bad;
    corrupt.push_back(header);
    auto patchStart = valid;
    patchStart[2] = bad;
    corrupt.push_back(patchStart);
  }

  for (const auto& words : corrupt) {
    // A fresh renderer, so "kept the previous program" cannot pass for "read it".
    tgfxrn::SceneRenderer renderer;
    renderer.setScene(words, {});
    CHECK(!anyPixelSet(drawFrame(renderer, {})));
  }
}

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

void animatedColorDrawsWhatTheLiteralDraws() {
  Writer literal;
  literal.push(1);
  literal.push(1);  // Rect
  literal.pushAnim(8);
  literal.pushAnim(8);
  literal.pushAnim(40);
  literal.pushAnim(40);
  literal.pushPaint(0xff3366cc, false);

  Writer animated;
  animated.push(1);
  animated.push(1);
  animated.pushAnim(8);
  animated.pushAnim(8);
  animated.pushAnim(40);
  animated.pushAnim(40);
  // The packed word is deliberately wrong: only the slots may reach the paint.
  animated.pushLiveColorPaint(
      0xff000000, {{{0, 0}, {0, 1}, {0, 2}, {1, -1}}});

  auto words = animated.finish();
  auto cached = render(literal.finish(), {}, {});
  CHECK(anyPixelSet(cached));
  CHECK(cached == render(words, {}, {0x33 / 255.0, 0x66 / 255.0, 0xcc / 255.0}));
  CHECK(cached != render(words, {}, {1.0, 0.0, 0.0}));
}

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

/// A <Text> node body, mirroring the Kind.Text case of writeDrawing(); zeroes mean "the paragraph's".
void writeRun(Writer& w, int textIndex, int familyIndex = 2, int weight = 0, int italic = 0,
              double size = 0, int hasColor = 0, double color = 0) {
  w.push(1);  // one run
  w.push(textIndex);
  w.push(familyIndex);
  w.push(weight);
  w.push(italic);
  w.push(0);  // letterSpacing
  w.push(size);
  w.push(hasColor);
  w.push(color);
}

void writeTextNode(Writer& w, double fontSize, int fontSizeSlot, int textIndex = 0,
                   double wrapWidth = 0, int align = 0, double lineHeight = 0,
                   int weight = 400, int style = 0, int runItalic = 0) {
  w.push(8);  // Text
  w.pushAnim(4);
  w.pushAnim(44);
  w.pushAnim(fontSize, fontSizeSlot);
  w.push(1);  // font family string index
  w.push(weight);
  w.push(style);  // 1 italic, 2 faux bold, 4 faux italic
  w.push(0);  // letterSpacing
  writeRun(w, textIndex, 2, 0, runItalic);
  w.push(wrapWidth);
  w.push(align);
  w.push(lineHeight);
  w.push(0);  // maxLines
  w.push(2);  // ellipsis string index (empty)
  w.pushPaint(0xff000000, false);
}

void writeText(Writer& w, double fontSize, int fontSizeSlot, int textIndex = 0,
               double wrapWidth = 0, int align = 0, double lineHeight = 0, int weight = 400,
               int style = 0, int runItalic = 0) {
  w.push(1);
  writeTextNode(w, fontSize, fontSizeSlot, textIndex, wrapWidth, align, lineHeight, weight, style,
                runItalic);
}

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

/// A slotted uniform must draw what the literal drew and still move, from a flat cross-uniform run.
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
  // Slot 1, not 0: resolving every component against values[0] would survive a slot-0 test.
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

  CHECK(render(words, strings, {0.0, 0.2}) != resolved);

  // An empty-named uniform must take its slots with it, or the flat run desyncs.
  auto withDropped = slotted;
  withDropped.insert(withDropped.begin(), {4, {{0.9, 0}, {0.9, -1}}});
  CHECK(render(write(withDropped), strings, {0.0, 0.6}) == baked);
}

/// A file-scope helper must reach the shader, and the preamble must key the compiled program.
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

  // Without the file-scope helper the body calls an undeclared tint and nothing paints.
  auto identity = draw(2, {3});
  CHECK(anyPixelSet(identity));
  // uLevel 0.75 here, 0.25 next, through a helper of the same name: one body, two programs.
  auto inverted = draw(4, {3});
  CHECK(anyPixelSet(inverted));
  CHECK(identity != inverted);
}

void aChildShaderSamplesWhereItIsAsked() {
  // A 2x1 image repeated across 32x32, so one texel of drift is a whole colour change.
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

  // The same child one texel right: a wrapper ignoring its argument redraws the block above.
  auto shifted = draw(2);
  auto shifted0 = pixelAt(shifted, 0, 0);
  CHECK(shifted0[0] == right[0] && shifted0[1] == right[1]);
}

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
  // Dark left, bright right: the child's own coordinate ramp reached it.
  CHECK(pixelAt(drawn, 1, 16)[0] < 40);
  CHECK(pixelAt(drawn, 30, 16)[0] > 200);
}

void twoChildrenOnOneShaderBothPaint() {
  // Child 0: a 2x1 image, red on the left texel and green on the right.
  auto left = cellColor(2);
  auto right = cellColor(20);
  std::vector<uint8_t> pixels(8);
  std::copy(left.begin(), left.end(), pixels.begin());
  std::copy(right.begin(), right.end(), pixels.begin() + 4);
  auto image = registerPixels(2, 1, pixels);

  const std::vector<std::vector<double>> children = {
      {7, static_cast<double>(image.handle), 1, 1, 0, 0},
      // Child 1: a black -> white ramp across the 32-wide rect.
      {0, 0, 0, 32, 0, 2, 0xff000000, 0xffffffff, 0},
  };
  // Child 0 in red and green (one shifted), child 1 in blue: a wrong binding is a wrong channel.
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
  // Column 0: child 0 at texels 0 and 1, child 1 near the dark end of its ramp.
  auto at0 = pixelAt(drawn, 0, 16);
  CHECK(at0[0] == left[0]);
  CHECK(at0[1] == right[1]);
  CHECK(at0[2] < 40);
  // The far end only differs in blue, which is the one channel child 1 drives.
  auto at30 = pixelAt(drawn, 30, 16);
  CHECK(at30[0] == left[0]);
  CHECK(at30[2] > 200);
}

void aRuntimeShaderChildNestsInOneProgram() {
  auto only = cellColor(7);
  std::vector<uint8_t> onePixel(only.begin(), only.end());
  auto image = registerPixels(1, 1, onePixel);

  const std::vector<std::string> strings = {
      "return TGFX_CHILD_0(fragCoord);",  // 0: both bodies
      "",                                 // 1: no preamble
  };
  // The inner runtime shader as a child payload: body, preamble, no functions, one child.
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

/// A miter limit under the join's ratio cuts the spike back to a bevel; over it, the spike stands.
void aMiterLimitCutsBackASharpSpike() {
  auto spike = [](double limit) {
    Writer w;
    w.push(1);
    w.push(6);  // Path
    w.push(0);  // path string index
    w.push(0xff000000);
    w.push(1 | 2 | (limit > 0 ? 16 : 0));  // stroke, antiAlias, and a miter limit when asked
    w.pushAnim(6);                         // strokeWidth
    w.push(0);                             // butt cap
    w.push(0);                             // miter join
    if (limit > 0) {
      w.push(limit);
    }
    w.pushAnim(1);  // alpha
    w.push(-1);     // no shader
    return render(w.finish(), {"M4 60 L32 6 L60 60"}, {});
  };
  auto bevelled = spike(1);
  auto mitered = spike(20);
  CHECK(anyPixelSet(bevelled));
  CHECK(bevelled != mitered);
  // The join's ratio here is ~2.2, so the spike runs well past where a bevel would cut it off.
  CHECK(opaqueAt(mitered, 32, 2));
  CHECK(!opaqueAt(bevelled, 32, 2));
  // The default, with no limit word at all, is 4 — over that ratio, so it keeps the spike.
  CHECK(opaqueAt(spike(0), 32, 2));
}

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

  Writer half;
  half.push(1);
  half.push(1);
  half.pushAnim(0);
  half.pushAnim(0);
  half.pushAnim(kWidth);
  half.pushAnim(kHeight / 2);
  half.pushPaint(0xff3366cc, false);
  CHECK(filled != render(half.finish(), {}, {}));

  const std::vector<std::string> strings = {
      "return vec4(uLevel, 0.0, 0.0, 1.0);", "uLevel", ""};
  const std::vector<Writer::Uniform> uniforms = {{1, {{0, 0}}}};

  Writer shaded;
  shaded.push(1);
  shaded.push(9);
  shaded.pushRuntimePaint(0xff000000, uniforms, 2);
  auto shadedWords = shaded.finish();
  auto shadedPixels = render(shadedWords, strings, {0.75});
  CHECK(anyPixelSet(shadedPixels));
  CHECK(shadedPixels != filled);
  CHECK(shadedPixels != render(shadedWords, strings, {0.25}));

  Writer faded;
  faded.push(1);
  faded.push(9);
  faded.pushPaint(0xff3366cc, false, 1, 0, 0);
  CHECK(render(faded.finish(), {}, {0.5}) != filled);
}

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

void reCommittingAnImageSceneDecodesNothing() {
  auto& registry = tgfxrn::ImageRegistry::instance();
  auto image = registerSolid(cellColor(3));
  size_t before = registry.decodeCount();

  tgfxrn::SceneRenderer renderer;
  for (int i = 0; i < 5; i++) {
    Writer w;
    w.push(1);
    w.pushImage(image.handle, i, 0, 8, 8);
    renderer.setScene(w.finish(), {});
  }
  CHECK(registry.decodeCount() == before);
}

/// Bytes with a real LRU, not a count with FIFO. Invisible in the pixels, so it is counted.
void theByteBudgetEvictsLeastRecentlyUsed() {
  auto& registry = tgfxrn::ImageRegistry::instance();
  size_t restore = registry.cacheLimit();
  auto a = registerSolid(cellColor(1), 32, 32);
  auto b = registerSolid(cellColor(2), 32, 32);
  auto c = registerSolid(cellColor(3), 32, 32);
  auto d = registerSolid(cellColor(4), 32, 32);
  CHECK(d.handle != 0);
  registry.setCacheLimit(3 * 32 * 32 * 4);
  CHECK(registry.cachedBytes() <= 3 * 32 * 32 * 4);
  size_t decodes = registry.decodeCount();

  // acquire() runs on the render thread, so an evicted entry comes back empty, never decoding.
  CHECK(registry.acquire(a.handle) == nullptr);
  CHECK(registry.decodeCount() == decodes);
  registry.waitForDecodes();
  CHECK(registry.decodeCount() == decodes + 1);
  CHECK(registry.acquire(a.handle) != nullptr);
  CHECK(registry.acquire(b.handle) == nullptr);

  CHECK(registry.acquire(c.handle) != nullptr);
  registry.waitForDecodes();
  CHECK(registry.decodeCount() == decodes + 2);
  CHECK(registry.acquire(c.handle) != nullptr);
  CHECK(registry.acquire(d.handle) == nullptr);

  registry.waitForDecodes();
  registry.setCacheLimit(restore);
}


void fitModesLetterboxAndCrop() {
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

  auto none = draw(5);
  CHECK(opaqueAt(none, 16, 16));
  CHECK(!opaqueAt(none, 16, 4));
}

void aSourceRectPicksOneSprite() {
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

void anImageShaderTilesAcrossAShape() {
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
  CHECK(at2[0] == at0[0] && at2[1] == at0[1]);
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

void anExternalHandleIsReplacedInPlaceAndNotBudgeted() {
  auto& registry = tgfxrn::ImageRegistry::instance();
  auto first = registerSolid(cellColor(11), 32, 32);
  auto second = registerSolid(cellColor(29), 32, 32);
  auto frameA = registry.acquire(first.handle);
  auto frameB = registry.acquire(second.handle);
  CHECK(frameA != nullptr && frameB != nullptr);

  size_t bytesBefore = registry.cachedBytes();
  auto external = registry.addExternal(frameA);
  CHECK(external.handle != 0 && external.width == 32);
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

  CHECK(registry.replaceExternal(external.handle, frameB));
  CHECK(registry.epoch() != epochBefore);
  // ...and the previous buffer is released there and then. Two refs left: local and entry.
  CHECK(frameA.use_count() == 2);

  auto expectedSecond = cellColor(29);
  auto after = pixelAt(drawFrame(renderer, {}), 16, 16);
  CHECK(after[0] == expectedSecond[0] && after[1] == expectedSecond[1]);

  CHECK(!registry.replaceExternal(first.handle, frameA));
  registry.remove(external.handle);
}

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

/// The frame and its children share one matrix, so an overlay in frame pixels cannot drift.
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
  auto overlay = pixelAt(pixels, 8, 8);
  CHECK(overlay[0] == 0 && overlay[2] == 255);
  CHECK(!(pixelAt(pixels, 40, 8)[2] == 255));
  auto uncovered = pixelAt(pixels, 48, 48);
  CHECK(uncovered[0] == first[0] && uncovered[1] == first[1]);

  // A new buffer behind the same handle, no re-commit: the overlay must not move.
  CHECK(registry.replaceExternal(external.handle, registry.acquire(next.handle)));
  auto second = cellColor(23);
  pixels = drawFrame(renderer, {});
  auto swapped = pixelAt(pixels, 48, 48);
  CHECK(swapped[0] == second[0] && swapped[1] == second[1]);
  auto stillThere = pixelAt(pixels, 8, 8);
  CHECK(stillThere[0] == 0 && stillThere[2] == 255);

  registry.remove(external.handle);
}

/// Which canvas corner a child at the frame's origin lands in, as {TL, TR, BL, BR}.
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

  auto quadrant = [&](int quarterTurns, bool mirror) {
    return cameraFrameChildCorner(external.handle, 32, 32, quarterTurns, mirror);
  };

  CHECK(quadrant(0, false) == kTopLeft);
  CHECK(quadrant(0, true) == kTopRight);
  CHECK(quadrant(1, false) == kTopRight);
  CHECK(quadrant(2, false) == kBottomRight);
  CHECK(quadrant(3, false) == kBottomLeft);
  registry.remove(external.handle);
}

/// Four turns on a non-square frame: with w == h the translate and the ow/oh swap both collapse.
void aCameraFrameRotatesANonSquareFrame() {
  auto& registry = tgfxrn::ImageRegistry::instance();
  auto frame = registerSolid(cellColor(7), 32, 16);
  auto external = registry.addExternal(registry.acquire(frame.handle));

  auto quadrant = [&](int quarterTurns) {
    return cameraFrameChildCorner(external.handle, 32, 16, quarterTurns, false);
  };

  CHECK(quadrant(0) == kTopLeft);
  CHECK(quadrant(1) == kTopRight);
  CHECK(quadrant(2) == kBottomRight);
  CHECK(quadrant(3) == kBottomLeft);
  // Mirroring flips about the frame's own axis: the wrong width puts the child off-canvas.
  CHECK(cameraFrameChildCorner(external.handle, 32, 16, 0, true) == kTopRight);
  registry.remove(external.handle);
}

void aCameraFrameCoverCropsTheOverflowingAxis() {
  auto& registry = tgfxrn::ImageRegistry::instance();
  auto wide = registerSolid(cellColor(7), 32, 16);
  auto external = registry.addExternal(registry.acquire(wide.handle));

  Writer w;
  w.push(1);
  w.pushCameraFrame(external.handle, 0);
  auto pixels = render(w.finish(), {}, {});
  auto expected = cellColor(7);
  for (auto [x, y] : {std::pair{1, 1}, {62, 1}, {1, 62}, {62, 62}}) {
    auto pixel = pixelAt(pixels, x, y);
    CHECK(pixel[0] == expected[0] && pixel[1] == expected[1]);
  }
  registry.remove(external.handle);
}

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

/// An asset evicted before the scene compiled must still appear when its re-decode lands.
void anImageEvictedBeforeCompileComesBackWhenItsDecodeLands() {
  auto& registry = tgfxrn::ImageRegistry::instance();
  size_t restore = registry.cacheLimit();
  auto victim = registerSolid(cellColor(17), 32, 32);
  auto keep = registerSolid(cellColor(23), 32, 32);
  CHECK(keep.handle != 0);
  registry.setCacheLimit(32 * 32 * 4);
  size_t decodes = registry.decodeCount();

  Writer w;
  w.push(1);
  w.pushImage(victim.handle, 0, 0, 32, 32);
  tgfxrn::SceneRenderer renderer;
  // Nothing has acquired `victim` since the eviction, so this compile schedules the re-decode.
  renderer.setScene(w.finish(), {});

  registry.setCacheLimit(restore);
  registry.waitForDecodes();
  CHECK(registry.decodeCount() == decodes + 1);
  CHECK(registry.acquire(victim.handle) != nullptr);

  auto expected = cellColor(17);
  auto after = pixelAt(drawFrame(renderer, {}), 16, 16);
  CHECK(after[0] == expected[0] && after[1] == expected[1]);
}

/// Both render loops are push-driven, so a swap that only moves the epoch schedules no frame.
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

  registry.remove(external.handle);
  CHECK(wakes == before + 2);
  registry.removeWakeListener(token);
  registry.replaceExternal(external.handle, registry.acquire(first.handle));
  CHECK(wakes == before + 2);
}

void aBlendModeCompositesAgainstWhatIsBelow() {
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

/// A blend mode left on the inner draw composites against the empty layer an image filter forces.
void aBlendModeSurvivesAnImageFilter() {
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
  CHECK(opaqueAt(scene(6), 34, 16));
  auto after = pixelAt(scene(0.5), 52, 52);
  CHECK(after[0] == 0 && after[1] == 255 && after[2] == 0);
}

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

  const std::vector<double> swap = {0, 0, 1, 0, 0, 0, 1, 0, 0, 0,
                                    1, 0, 0, 0, 0, 0, 0, 0, 1, 0};
  auto swapped = pixelAt(draw(swap), 16, 16);
  auto source = pixelAt(unfiltered, 16, 16);
  CHECK(swapped[0] == source[2] && swapped[2] == source[0]);
  CHECK(swapped[1] == source[1]);
}

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
  CHECK(!opaqueAt(sharp, 14, 32));
  auto blurred = draw(6);
  CHECK(opaqueAt(blurred, 14, 32));
  CHECK(opaqueAt(blurred, 32, 32));
}

void aDropShadowPaintsUnderItsContent() {
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
  auto content = pixelAt(shadowed, 28, 28);
  CHECK(content[0] == 255 && content[1] == 255 && content[2] == 255);

  auto only = draw(1);
  CHECK(opaqueAt(only, 44, 44));
  CHECK(!opaqueAt(only, 28, 28));
}

/// A filter must be built once, by setScene, and never again. Counted, not reasoned about.
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

  for (int frame = 0; frame < 10; frame++) {
    CHECK(anyPixelSet(drawFrame(renderer, {1})));
  }
  CHECK(tgfxrn::filterBuildCount() == afterCompile);
}


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

/// The acceptance case: an Android image with none of the three paths the old code hardcoded.
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
  CHECK(best(oemImage, "", 400, false) != 0);
  CHECK(best(oemImage, "", 700, false) != best(oemImage, "", 400, false));

  const std::vector<std::string> withFamily{"/system/fonts/Roboto-Regular.ttf",
                                            "/system/fonts/PlayfairDisplay-Regular.ttf"};
  CHECK(best(withFamily, "Playfair Display", 400, false) == 1);
  CHECK(best(withFamily, "playfair-display", 400, false) == 1);
  CHECK(tgfxrn::rankFontFiles({"/system/fonts/NotoColorEmoji.ttf"}, "", 400, false).empty());

  // Every candidate, best first: NotoSansCham-Bold outranks and has no Latin, so walking matters.
  const std::vector<std::string> samsung{
      "/system/fonts/DroidSans-Bold.ttf", "/system/fonts/NotoColorEmoji.ttf",
      "/system/fonts/NotoSansCham-Bold.ttf", "/system/fonts/Roboto-Regular.ttf"};
  auto ranked = tgfxrn::rankFontFiles(samsung, "", 700, false);
  CHECK(ranked.size() >= 3);
  CHECK(std::find(ranked.begin(), ranked.end(), 0) != ranked.end());
  CHECK(std::find(ranked.begin(), ranked.end(), 1) == ranked.end());

  // A named family must not promote a special-purpose face: "Noto" prefix-matches NotoColorEmoji.
  const std::vector<std::string> noto{"/system/fonts/NotoColorEmoji.ttf",
                                      "/system/fonts/SamsungOne-400.ttf"};
  CHECK(best(noto, "Noto", 400, false) == 1);
  CHECK(tgfxrn::rankFontFiles(noto, "Noto", 400, false).size() == 1);
  CHECK(best(noto, "Noto Color Emoji", 400, false) == 0);
}

/// The path cache is shared with the fallback chain, so a hit must clear the same bar as an open.
void aCachedFaceStillHasToBeAbleToDrawText() {
  auto& registry = tgfxrn::FontRegistry::instance();
  registry.clear();
  auto fallbacks = registry.fallbacks();
  CHECK(!fallbacks.empty());
  for (const auto& typeface : fallbacks) {
    CHECK(typeface->getGlyphID('A') == 0);
  }
  for (const char* family : {"", "Noto", "Apple Color Emoji", "No Such Family"}) {
    auto match = registry.match(family, 400, false);
    CHECK(match.typeface != nullptr);
    if (match.typeface != nullptr) {
      CHECK(match.typeface->getGlyphID('A') != 0);
    }
  }
  registry.clear();
}

/// <Text> with no fontFamily must resolve to something that can draw Latin, which CoreText will not.
void theDefaultFamilyCanActuallyDrawText() {
  auto& registry = tgfxrn::FontRegistry::instance();
  registry.clear();
  auto fallback = registry.match("", 400, false);
  CHECK(fallback.typeface != nullptr);
  if (fallback.typeface != nullptr) {
    CHECK(fallback.typeface->getGlyphID('A') != 0);
    CHECK(fallback.typeface->getGlyphID('0') != 0);
  }
  auto unknown = registry.match("No Such Family At All", 400, false);
  CHECK(unknown.typeface != nullptr && unknown.typeface->getGlyphID('A') != 0);

  Writer w;
  writeText(w, 24, -1, 0);
  CHECK(anyPixelSet(render(w.finish(), {"Wg", "", ""}, {})));
}

/// loadFont() is a bare promise, so registering a face has to schedule the draw itself.
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

  registry.add(nullptr, "Wake Serif");
  CHECK(wakes == 1);

  tgfxrn::ImageRegistry::instance().removeWakeListener(token);
  registry.add(tgfx::Typeface::MakeFromPath(std::string(kFontDir) + "/PT_Serif-Web-Bold.ttf"),
               "Wake Serif");
  CHECK(wakes == 1);
  registry.clear();
}

/// The layout is memoised per command, so a late face is only picked up by recompiling.
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
  CHECK(drawFrame(renderer, {}) == fallback);
  renderer.setScene(words, strings);
  CHECK(drawFrame(renderer, {}) != fallback);
  registry.clear();
}

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
  CHECK(tgfxrn::readFaceStyle(regular).weight == 400);
  CHECK(tgfxrn::readFaceStyle(bold).weight >= 700);
  CHECK(!tgfxrn::readFaceStyle(regular).italic);
  CHECK(tgfxrn::readFaceStyle(italic).italic);

  uint64_t before = registry.epoch();
  CHECK(registry.add(regular, "Demo Serif") == "Demo Serif");
  registry.add(bold, "Demo Serif");
  registry.add(italic, "Demo Serif");
  CHECK(registry.epoch() > before);

  CHECK(registry.match("Demo Serif", 400, false).typeface == regular);
  CHECK(registry.match("Demo Serif", 700, false).typeface == bold);
  CHECK(registry.match("Demo Serif", 500, false).typeface == regular);
  CHECK(registry.match("Demo Serif", 400, true).typeface == italic);
  CHECK(registry.match("demoserif", 700, false).typeface == bold);
  auto black = registry.match("Demo Serif", 900, false);
  CHECK(black.typeface == bold && black.fauxBold);
  CHECK(registry.match("Nothing By This Name", 400, false).typeface != nullptr);
  registry.clear();
}

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

  Writer system;
  writeText(system, 28, -1, 0, 0, 0, 0, 400, 0);
  CHECK(render(system.finish(), {"Wg", "Helvetica", ""}, {}) != regularPixels);
  registry.clear();
}

/// The faux bits force synthesis even where the family has a face good enough to skip it.
void theFauxBitsEmboldenAndShearAMatchedFace() {
  auto& registry = tgfxrn::FontRegistry::instance();
  registry.clear();
  registry.add(tgfx::Typeface::MakeFromPath(std::string(kFontDir) + "/PT_Serif-Web-Regular.ttf"),
               "Demo Serif");
  const std::vector<std::string> strings{"Wg", "Demo Serif", ""};

  auto draw = [&](int style) {
    Writer w;
    writeText(w, 28, -1, 0, 0, 0, 0, 400, style);
    return render(w.finish(), strings, {});
  };
  auto plain = draw(0);
  CHECK(anyPixelSet(plain));
  CHECK(draw(2) != plain);
  CHECK(draw(4) != plain);
  CHECK(draw(2) != draw(4));

  // A run that overrode the axis keeps its own face: 2 forces upright, 1 forces italic.
  auto span = [&](int style, int runItalic) {
    Writer w;
    writeText(w, 28, -1, 0, 0, 0, 0, 400, style, runItalic);
    return render(w.finish(), strings, {});
  };
  CHECK(span(4, 2) == span(0, 2));
  CHECK(span(4, 0) != span(0, 0));
  registry.clear();
}

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

  Writer right;
  writeText(right, 10, -1, 0, 40, 2, 0);
  CHECK(render(right.finish(), strings, {}) != stacked);

  tgfxrn::TextSpec spec;
  spec.family = "Helvetica";
  spec.wrapWidth = 40;
  auto natural = tgfxrn::layoutText({run("one two three four")}, spec, 10);
  spec.lineHeight = 24;
  auto tall = tgfxrn::layoutText({run("one two three four")}, spec, 10);
  CHECK(natural.metrics.lineCount == tall.metrics.lineCount);
  CHECK(tall.metrics.height > natural.metrics.height);
}

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

void theMeasuredWidthIsTheDrawnWidth() {
  tgfxrn::FontRegistry::instance().clear();
  tgfxrn::TextSpec spec;
  spec.family = "Helvetica";
  auto measured = tgfxrn::layoutText({run("Wg")}, spec, 24);
  CHECK(!measured.runs.empty());
  CHECK(measured.metrics.width > 0);
  CHECK(measured.metrics.lineCount == 1);

  Writer w;
  w.push(1);
  w.push(8);
  w.pushAnim(0);
  w.pushAnim(40);
  w.pushAnim(24);
  w.push(1);
  w.push(400);
  w.push(0);
  w.push(0);
  writeRun(w, 0);
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

  spec.wrapWidth = 40;
  auto wrapped = tgfxrn::layoutText({run("one two three four")}, spec, 12);
  CHECK(wrapped.metrics.lineCount > 1);
  CHECK(wrapped.metrics.width <= 40);
  CHECK(wrapped.metrics.height > wrapped.metrics.descent - wrapped.metrics.ascent);

  spec.maxLines = 1;
  spec.ellipsis = "...";
  auto clipped = tgfxrn::layoutText({run("one two three four")}, spec, 12);
  CHECK(clipped.metrics.lineCount == 1);
  CHECK(clipped.metrics.width <= 40);
}

/// Cached by rounded size: without it an animated fontSize builds a ScalerContext every frame.
void theLayoutIsCachedByQuantisedSize() {
  tgfxrn::FontRegistry::instance().clear();
  tgfxrn::TextCmd cmd;
  cmd.runs = {run("Wg")};
  cmd.spec.family = "Helvetica";
  auto blobOf = [](const tgfxrn::TextLayout& layout) {
    return layout.runs.empty() ? nullptr : layout.runs[0].blob;
  };
  auto at20 = blobOf(cmd.resolve(20));
  CHECK(at20 != nullptr);
  CHECK(blobOf(cmd.resolve(20.1f)) == at20);
  CHECK(blobOf(cmd.resolve(20)) == at20);
  CHECK(blobOf(cmd.resolve(24)) != at20);
}

/// A codepoint the primary face lacks must reach a fallback, not the blank gap glyph 0 leaves.
void anEmojiFallsBackInsteadOfVanishing() {
  tgfxrn::FontRegistry::instance().clear();
  const std::vector<std::string> strings{"\xF0\x9F\x98\x80", "Helvetica", ""};
  Writer w;
  writeText(w, 28, -1, 0);
  auto pixels = render(w.finish(), strings, {});
  CHECK(!tgfxrn::FontRegistry::instance().fallbacks().empty());
  CHECK(anyPixelSet(pixels));

  // A forced faux bit has to reach the fallback too, or one string draws at two weights.
  const std::vector<std::string> mixed{"a\xE4\xB8\xAD", "Helvetica", ""};
  Writer plainRun;
  writeText(plainRun, 28, -1, 0);
  Writer boldRun;
  writeText(boldRun, 28, -1, 0, 0, 0, 0, 400, 2);
  CHECK(render(boldRun.finish(), mixed, {}) != render(plainRun.finish(), mixed, {}));
}

void textOnAPathFollowsTheCurve() {
  tgfxrn::FontRegistry::instance().clear();
  const std::vector<std::string> strings{"M4 40 q28 -32 56 0", "curve", "Helvetica"};
  Writer w;
  w.push(1);
  w.push(10);  // TextPath
  w.push(0);   // path
  w.pushAnim(12);
  w.push(2);  // family
  w.push(400);
  w.push(0);
  w.push(0);
  writeRun(w, 1, 2);
  w.push(0);  // startOffset
  w.pushPaint(0xff000000, false);
  auto curved = render(w.finish(), strings, {});
  CHECK(anyPixelSet(curved));

  Writer flat;
  writeText(flat, 12, -1, 0);
  CHECK(render(flat.finish(), {"curve", "Helvetica", ""}, {}) != curved);
}

void aDisposedHandleDrawsNothing() {
  auto image = registerSolid(cellColor(5));
  tgfxrn::ImageRegistry::instance().remove(image.handle);
  Writer w;
  w.push(1);
  w.pushImage(image.handle, 0, 0, 32, 32);
  CHECK(!anyPixelSet(render(w.finish(), {}, {})));
}

/// A JPEG with the EXIF marker a phone writes for a portrait photo, built here so the bytes show.
std::shared_ptr<tgfx::Data> exifRotatedJpeg(int width, int height) {
  std::vector<uint8_t> pixels(static_cast<size_t>(width) * height * 4, 255);
  auto info = tgfx::ImageInfo::Make(width, height, tgfx::ColorType::RGBA_8888,
                                    tgfx::AlphaType::Opaque);
  tgfx::Pixmap pixmap(info, pixels.data());
  auto jpeg = tgfx::ImageCodec::Encode(pixmap, tgfx::EncodedFormat::JPEG, 100);
  if (jpeg == nullptr) {
    return nullptr;
  }
  // APP1: length, "Exif\0\0", then a little-endian TIFF whose one entry is Orientation = 6.
  const std::array<uint8_t, 36> app1 = {
      0xFF, 0xE1, 0x00, 0x22,                          // marker, length (34)
      'E',  'x',  'i',  'f',  0x00, 0x00,              // Exif\0\0
      'I',  'I',  0x2A, 0x00, 0x08, 0x00, 0x00, 0x00,  // II, 42, IFD0 at 8
      0x01, 0x00,                                      // one entry
      0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00,  // Orientation, SHORT, 1
      0x06, 0x00, 0x00, 0x00,                          // = 6
      0x00, 0x00, 0x00, 0x00};                         // no next IFD
  auto bytes = static_cast<const uint8_t*>(jpeg->data());
  std::vector<uint8_t> out;
  out.reserve(jpeg->size() + app1.size());
  out.insert(out.end(), bytes, bytes + 2);
  out.insert(out.end(), app1.begin(), app1.end());
  out.insert(out.end(), bytes + 2, bytes + jpeg->size());
  return tgfx::Data::MakeWithCopy(out.data(), out.size());
}

/// A portrait photo must draw upright, through JpegCodec by name rather than the host codec.
void anExifRotatedJpegDecodesUpright() {
  auto data = exifRotatedJpeg(64, 32);
  CHECK(data != nullptr);
  if (data == nullptr) {
    return;
  }
  CHECK(tgfx::JpegCodec::IsJpeg(data));
  auto codec = tgfx::JpegCodec::MakeFrom(data);
  CHECK(codec != nullptr);
  if (codec == nullptr) {
    return;
  }
  CHECK(codec->orientation() == tgfx::Orientation::RightTop);

  auto handle = tgfxrn::ImageRegistry::instance().add(codec);
  auto image = tgfxrn::ImageRegistry::instance().acquire(handle.handle);
  CHECK(image != nullptr);
  if (image != nullptr) {
    CHECK(image->width() == 32);
    CHECK(image->height() == 64);
  }
  tgfxrn::ImageRegistry::instance().remove(handle.handle);
}

/// A 24x24 document whose viewBox is half its declared size, so a scale that ignored either
/// one would land the square somewhere else.
constexpr const char* kSvgDoc =
    R"(<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 12 12">
         <rect x="0" y="0" width="12" height="12" fill="#3366cc"/>
       </svg>)";

void anSvgDocumentBecomesAnImageHandle() {
  auto data = tgfx::Data::MakeWithCopy(kSvgDoc, std::strlen(kSvgDoc));
  CHECK(tgfxrn::looksLikeSvg(*data));
  CHECK(!tgfxrn::looksLikeSvg(*tgfx::Data::MakeWithCopy("\x89PNG\r\n", 6)));

  // The declared 24x24, not the 12x12 viewBox: a scale that read either alone would disagree.
  auto image = tgfxrn::svgImage(data);
  CHECK(image != nullptr && image->width() == 24 && image->height() == 24);
  if (image == nullptr) {
    return;
  }

  auto handle = tgfxrn::ImageRegistry::instance().addExternal(std::move(image));
  CHECK(handle.handle != 0 && handle.width == 24 && handle.height == 24);
  Writer w;
  w.push(1);
  w.pushImage(handle.handle, 0, 0, kWidth, kHeight);
  auto got = pixelAt(render(w.finish(), {}, {}), kWidth / 2, kHeight / 2);
  CHECK(got[0] == 0x33 && got[1] == 0x66 && got[2] == 0xcc);
  tgfxrn::ImageRegistry::instance().remove(handle.handle);
}

/// The reason there is no explicit SVG raster size: a handle built at the document's own size
/// replays the picture at draw resolution, so drawing it 8x larger stays crisp. If tgfx ever
/// starts resampling the nominal raster instead, the upscaled edge widens and this fails.
void anSvgHandleStaysCrispWhenDrawnLargerThanItsSize() {
  // Two draws, so Image::MakeFrom cannot take its single-draw unwrap path — this has to be a
  // real PictureImage, which is the case the resampling worry was about.
  const char* doc =
      R"(<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8">
           <path d="M0 0 L8 0 L0 8 Z" fill="#000000"/>
           <rect x="6" y="6" width="2" height="2" fill="#000000"/>
         </svg>)";
  auto draw = [](std::shared_ptr<tgfx::Image> image) {
    auto handle = tgfxrn::ImageRegistry::instance().addExternal(std::move(image));
    Writer w;
    w.push(1);
    w.pushImage(handle.handle, 0, 0, kWidth, kHeight);
    auto pixels = render(w.finish(), {}, {});
    tgfxrn::ImageRegistry::instance().remove(handle.handle);
    return pixels;
  };
  auto eightPx = tgfxrn::svgImage(tgfx::Data::MakeWithCopy(doc, std::strlen(doc)));
  CHECK(eightPx != nullptr && eightPx->width() == 8);
  if (eightPx == nullptr) {
    return;
  }
  auto drawn = draw(std::move(eightPx));

  // Partly-covered pixels along the diagonal, on the row through the middle. Antialiasing gives
  // one; resampling an 8px raster into a 64px box would smear it across about eight.
  int soft = 0;
  for (int x = 0; x < kWidth; x++) {
    auto alpha = drawn[static_cast<size_t>((kHeight / 2 * kWidth + x) * 4 + 3)];
    if (alpha > 24 && alpha < 231) {
      soft++;
    }
  }
  CHECK(soft <= 2);
}

void malformedSvgIsRejectedRatherThanDrawn() {
  CHECK(tgfxrn::svgImage(tgfx::Data::MakeWithCopy("<svg><rect", 10)) == nullptr);
  // Well-formed XML, but not an <svg> root.
  CHECK(tgfxrn::svgImage(tgfx::Data::MakeWithCopy("<html></html>", 13)) == nullptr);
  // Parses, but has no size to draw into.
  const char* sizeless = R"(<svg xmlns="http://www.w3.org/2000/svg"/>)";
  CHECK(tgfxrn::svgImage(tgfx::Data::MakeWithCopy(sizeless, std::strlen(sizeless))) == nullptr);
  CHECK(tgfxrn::svgImage(nullptr) == nullptr);
}

void aParagraphKeepsItsItalicThroughTheRuns() {
  tgfxrn::FontRegistry::instance().clear();
  tgfxrn::TextSpec spec;
  spec.family = "Helvetica";
  // Pixels, not widths: a synthesised italic is a shear at identical advances.
  const std::vector<std::string> strings{"italic", "Helvetica", ""};
  Writer upright;
  writeText(upright, 24, -1, 0, 0, 0, 0, 400, 0);
  Writer slanted;
  writeText(slanted, 24, -1, 0, 0, 0, 0, 400, 1);
  auto flat = render(upright.finish(), strings, {});
  auto leaning = render(slanted.finish(), strings, {});
  CHECK(anyPixelSet(flat));
  CHECK(flat != leaning);

  Writer overridden;
  writeText(overridden, 24, -1, 0, 0, 0, 0, 400, 1, 2);
  CHECK(render(overridden.finish(), strings, {}) == flat);
  Writer opted;
  writeText(opted, 24, -1, 0, 0, 0, 0, 400, 0, 1);
  CHECK(render(opted.finish(), strings, {}) == leaning);

  tgfxrn::TextSpec italicSpec = spec;
  italicSpec.italic = true;
  auto outline = [](const tgfxrn::TextRun& r, const tgfxrn::TextSpec& sp) {
    return tgfxrn::textToPath({r}, sp, 24).getBounds();
  };
  tgfxrn::TextRun inherits;
  inherits.text = "italic";
  tgfxrn::TextRun forced = inherits;
  forced.italic = 2;
  CHECK(outline(inherits, italicSpec) != outline(inherits, spec));
  CHECK(outline(forced, italicSpec) == outline(inherits, spec));
}

void theEllipsisBelongsToTheRunItFollows() {
  tgfxrn::FontRegistry::instance().clear();
  tgfxrn::TextSpec spec;
  spec.family = "Helvetica";
  spec.wrapWidth = 60;
  spec.maxLines = 1;
  spec.ellipsis = "...";
  tgfxrn::TextRun first;
  first.text = "one two ";
  tgfxrn::TextRun tail;
  tail.text = "three four five";
  tail.hasColor = true;
  tail.color = 0xFF00FF00;
  auto layout = tgfxrn::layoutText({first, tail}, spec, 12);
  CHECK(layout.metrics.lineCount == 1);
  CHECK(!layout.metrics.lines.empty());
  CHECK(layout.runs.size() == 1);
  CHECK(!layout.runs[0].hasColor);
  CHECK(layout.metrics.lines[0].endIndex > 0);

  tgfxrn::TextRun lead;
  lead.text = "one ";
  tgfxrn::TextRun rest;
  rest.text = "two three four five";
  rest.hasColor = true;
  rest.color = 0xFF00FF00;
  auto coloured = tgfxrn::layoutText({lead, rest}, spec, 12);
  CHECK(coloured.metrics.lineCount == 1);
  CHECK(coloured.runs.size() == 2);
  CHECK(coloured.runs.back().hasColor);
}

void aSpanCarriesItsOwnFace() {
  tgfxrn::FontRegistry::instance().clear();
  tgfxrn::TextSpec spec;
  spec.family = "Helvetica";
  auto plain = tgfxrn::layoutText({run("one two")}, spec, 20);

  tgfxrn::TextRun first;
  first.text = "one ";
  tgfxrn::TextRun bold;
  bold.text = "two";
  bold.weight = 700;
  auto mixed = tgfxrn::layoutText({first, bold}, spec, 20);
  CHECK(!mixed.runs.empty());
  CHECK(mixed.metrics.lineCount == 1);
  CHECK(mixed.metrics.width > plain.metrics.width);

  tgfxrn::TextRun big;
  big.text = "two";
  big.size = 40;
  auto tall = tgfxrn::layoutText({first, big}, spec, 20);
  CHECK(tall.metrics.lineCount == 1);
  CHECK(tall.metrics.height > plain.metrics.height);
}

void aColouredSpanSplitsTheBlobs() {
  tgfxrn::FontRegistry::instance().clear();
  tgfxrn::TextSpec spec;
  spec.family = "Helvetica";
  tgfxrn::TextRun plain;
  plain.text = "one ";
  tgfxrn::TextRun red;
  red.text = "two";
  red.hasColor = true;
  red.color = 0xFFFF0000;
  auto layout = tgfxrn::layoutText({plain, red}, spec, 20);
  CHECK(layout.runs.size() == 2);
  CHECK(!layout.runs[0].hasColor);
  CHECK(layout.runs[1].hasColor);
  CHECK(layout.runs[1].color == 0xFFFF0000);

  tgfxrn::TextRun more;
  more.text = "three";
  CHECK(tgfxrn::layoutText({plain, more}, spec, 20).runs.size() == 1);

  const std::vector<std::string> strings{"one ", "Helvetica", "", "two"};
  auto write = [&](bool coloured) {
    Writer w;
    w.push(1);
    w.push(8);  // Text
    w.pushAnim(2);
    w.pushAnim(40);
    w.pushAnim(20);
    w.push(1);
    w.push(400);
    w.push(0);
    w.push(0);
    w.push(2);  // two runs
    w.push(0);
    w.push(2);
    w.push(0);
    w.push(0);
    w.push(0);
    w.push(0);
    w.push(0);
    w.push(0);
    w.push(3);
    w.push(2);
    w.push(0);
    w.push(0);
    w.push(0);
    w.push(0);
    w.push(coloured ? 1 : 0);
    w.push(coloured ? 0xFFFF0000 : 0);
    w.push(0);
    w.push(0);
    w.push(0);
    w.push(0);
    w.push(2);
    w.pushPaint(0xff000000, false);
    return render(w.finish(), strings, {});
  };
  auto mono = write(false);
  auto tinted = write(true);
  CHECK(anyPixelSet(mono));
  CHECK(mono != tinted);
}

void everyLineIsMeasured() {
  tgfxrn::FontRegistry::instance().clear();
  tgfxrn::TextSpec spec;
  spec.family = "Helvetica";
  spec.wrapWidth = 40;
  spec.align = tgfxrn::TextAlign::Right;
  auto layout = tgfxrn::layoutText({run("one two three four")}, spec, 12);
  CHECK(layout.metrics.lines.size() == static_cast<size_t>(layout.metrics.lineCount));
  CHECK(layout.metrics.lines.size() > 1);
  CHECK(layout.metrics.lines[0].baseline == 0);

  tgfxrn::TextSpec plain;
  plain.family = "Helvetica";
  auto blanks = tgfxrn::layoutText({run("a\n\nb")}, plain, 12);
  CHECK(blanks.metrics.lines.size() == 3);
  CHECK(blanks.metrics.lines[1].startIndex == 2);
  auto trailing = tgfxrn::layoutText({run("a\n")}, plain, 12);
  CHECK(trailing.metrics.lines.size() == 2);
  CHECK(trailing.metrics.lines[1].startIndex == 2);
  for (size_t i = 1; i < layout.metrics.lines.size(); i++) {
    const auto& line = layout.metrics.lines[i];
    CHECK(line.baseline > layout.metrics.lines[i - 1].baseline);
    CHECK(std::abs(line.x + line.width - spec.wrapWidth) < 0.01f);
    CHECK(line.startIndex >= layout.metrics.lines[i - 1].endIndex);
  }
}

void textComesBackAsAPath() {
  tgfxrn::FontRegistry::instance().clear();
  tgfxrn::TextSpec spec;
  spec.family = "Helvetica";
  auto path = tgfxrn::textToPath({run("Wg")}, spec, 40);
  CHECK(!path.isEmpty());

  auto measured = tgfxrn::layoutText({run("Wg")}, spec, 40);
  auto bounds = path.getBounds();
  CHECK(bounds.width() <= measured.metrics.width + 1);
  CHECK(bounds.width() > measured.metrics.width * 0.7f);
  CHECK(bounds.top >= measured.metrics.ascent - 1);
  CHECK(bounds.top < 0);

  auto data = tgfxrn::pathToSvg(path);
  CHECK(!data.empty());
  auto reparsed = tgfxrn::parseSvgPath(data);
  auto again = reparsed.getBounds();
  CHECK(std::abs(again.width() - bounds.width()) < 0.5f);
  CHECK(std::abs(again.height() - bounds.height()) < 0.5f);

  spec.wrapWidth = 30;
  auto wrapped = tgfxrn::textToPath({run("Wg Wg Wg")}, spec, 40);
  CHECK(wrapped.getBounds().height() > bounds.height());
}

void pathUtilitiesAgreeWithTheGeometryTheyWrap() {
  const std::string big = "M0 0 L40 0 L40 40 L0 40 Z";
  const std::string small = "M10 10 L30 10 L30 30 L10 30 Z";

  auto boxOf = [](const std::string& d) { return tgfxrn::pathBounds(d, false); };
  CHECK(boxOf(big).width() == 40 && boxOf(big).height() == 40);
  CHECK(boxOf(big).left == 0 && boxOf(big).top == 0);

  // Difference punches the small square out, so the centre stops being inside.
  auto holed = tgfxrn::pathCombine(big, small, "difference");
  CHECK(tgfxrn::pathContains(big, 20, 20));
  CHECK(!tgfxrn::pathContains(holed, 20, 20));
  CHECK(tgfxrn::pathContains(holed, 5, 5));
  CHECK(boxOf(holed).width() == 40);

  // Curves take the same reversal path as lines, so a round hole has to survive it too.
  auto ring = tgfxrn::pathCombine(
      "M0 0 L60 0 L60 60 L0 60 Z",
      "M30 10 C41 10 50 19 50 30 C50 41 41 50 30 50 C19 50 10 41 10 30 C10 19 19 10 30 10 Z",
      "difference");
  CHECK(!tgfxrn::pathContains(ring, 30, 30));
  CHECK(tgfxrn::pathContains(ring, 3, 3));

  auto both = tgfxrn::pathCombine(big, small, "intersect");
  CHECK(std::abs(boxOf(both).width() - 20) < 0.01f);

  // An unknown op appends rather than guessing, so the union of the boxes stands.
  CHECK(std::abs(boxOf(tgfxrn::pathCombine(big, small, "wat")).width() - 40) < 0.01f);

  // [a, b, c, d, tx, ty]: scale 2 and shift 5, as SVG writes it.
  auto moved = tgfxrn::pathTransform(big, {2, 0, 0, 2, 5, 5});
  CHECK(std::abs(boxOf(moved).left - 5) < 0.01f);
  CHECK(std::abs(boxOf(moved).width() - 80) < 0.01f);
  CHECK(tgfxrn::pathTransform(big, {1, 0}) == tgfxrn::pathTransform(big, {1, 0, 0, 1, 0, 0}));

  const std::string line = "M0 0 L100 0";
  CHECK(std::abs(tgfxrn::pathLength(line) - 100) < 0.01f);
  auto at = tgfxrn::pathPointAtLength(line, 25);
  CHECK(at.ok && std::abs(at.x - 25) < 0.01f && std::abs(at.y) < 0.01f);
  CHECK(std::abs(at.angle) < 0.01f);  // straight along +x
  // Distance is pinned to the path, not extrapolated past its end.
  CHECK(std::abs(tgfxrn::pathPointAtLength(line, 500).x - 100) < 0.01f);

  auto middle = tgfxrn::pathSegment(line, 20, 60);
  CHECK(std::abs(tgfxrn::pathLength(middle) - 40) < 0.01f);
  CHECK(tgfxrn::pathSegment(line, 60, 20).empty());
  CHECK(tgfxrn::pathLength("") == 0);
  CHECK(!tgfxrn::pathPointAtLength("", 1).ok);
}

/// <Glyphs> draws exactly the ids it is handed, where it is told: no shaping, no fallback.
void placedGlyphsDrawWhereTheyArePut() {
  tgfxrn::FontRegistry::instance().clear();
  tgfxrn::TextSpec spec;
  spec.family = "Helvetica";
  auto ids = tgfxrn::glyphIdsFor("Wg", spec, 20);
  CHECK(ids.size() == 2);
  CHECK(ids[0] != 0);

  auto write = [&](float secondX) {
    Writer w;
    w.push(1);
    w.push(12);  // Glyphs
    w.pushAnim(2);
    w.pushAnim(40);
    w.pushAnim(20);
    w.push(1);  // family
    w.push(400);
    w.push(0);
    w.push(0);
    w.push(2);  // two glyphs
    w.push(ids[0]);
    w.push(0);
    w.push(0);
    w.push(ids[1]);
    w.push(secondX);
    w.push(0);
    w.pushPaint(0xff000000, false);
    return render(w.finish(), {"", "Helvetica"}, {});
  };
  auto together = write(14);
  auto apart = write(34);
  CHECK(anyPixelSet(together));
  CHECK(anyPixelSet(apart));
  CHECK(together != apart);
  CHECK(rightmostInk(apart) > rightmostInk(together));

  Writer bogus;
  bogus.push(1);
  bogus.push(12);
  bogus.pushAnim(2);
  bogus.pushAnim(40);
  bogus.pushAnim(20);
  bogus.push(1);
  bogus.push(400);
  bogus.push(0);
  bogus.push(0);
  bogus.push(1);
  bogus.push(60000);
  bogus.push(0);
  bogus.push(0);
  bogus.pushPaint(0xff000000, false);
  render(bogus.finish(), {"", "Helvetica"}, {});
}

int main() {
  if (device() == nullptr) {
    std::printf("no GPU device available\n");
    return 1;
  }
  aCorruptProgramIsRejectedWithoutTrustingItsCounts();
  staticPaintDrawsWhatTheRebuildDraws();
  animatedColorDrawsWhatTheLiteralDraws();
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
  aMiterLimitCutsBackASharpSpike();
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
  anExifRotatedJpegDecodesUpright();
  anSvgDocumentBecomesAnImageHandle();
  anSvgHandleStaysCrispWhenDrawnLargerThanItsSize();
  malformedSvgIsRejectedRatherThanDrawn();
  aParagraphKeepsItsItalicThroughTheRuns();
  theEllipsisBelongsToTheRunItFollows();
  aSpanCarriesItsOwnFace();
  aColouredSpanSplitsTheBlobs();
  everyLineIsMeasured();
  textComesBackAsAPath();
  pathUtilitiesAgreeWithTheGeometryTheyWrap();
  placedGlyphsDrawWhereTheyArePut();
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
  theFauxBitsEmboldenAndShearAMatchedFace();
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
