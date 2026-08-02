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

/// Compile `words` and draw one frame against `values`, returning the pixels.
Pixels render(const std::vector<double>& words,
              const std::vector<std::string>& strings,
              const std::vector<double>& values) {
  tgfxrn::SceneRenderer renderer;
  renderer.setScene(words, strings);
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

std::string base64Encode(const std::string& bytes) {
  static const char* table =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out;
  for (size_t i = 0; i < bytes.size(); i += 3) {
    size_t n = std::min<size_t>(3, bytes.size() - i);
    uint32_t chunk = 0;
    for (size_t j = 0; j < 3; j++) {
      chunk = (chunk << 8) | (j < n ? static_cast<uint8_t>(bytes[i + j]) : 0u);
    }
    for (size_t j = 0; j < 4; j++) {
      out += (j <= n) ? table[(chunk >> (18 - 6 * j)) & 63] : '=';
    }
  }
  return out;
}

/// The payload the JS side would send for a solid 2x2 image of `rgba`.
std::string imagePayload(const std::array<uint8_t, 4>& rgba) {
  std::array<uint8_t, 16> pixels{};
  for (int i = 0; i < 4; i++) {
    std::copy(rgba.begin(), rgba.end(), pixels.begin() + i * 4);
  }
  auto info = tgfx::ImageInfo::Make(2, 2, tgfx::ColorType::RGBA_8888,
                                    tgfx::AlphaType::Premultiplied);
  tgfx::Pixmap pixmap(info, pixels.data());
  auto data = tgfx::ImageCodec::Encode(pixmap, tgfx::EncodedFormat::PNG, 100);
  if (data == nullptr) {
    return "";
  }
  return base64Encode(
      std::string(reinterpret_cast<const char*>(data->data()), data->size()));
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

/// The image cache is keyed by a hash of the payload and holds 32 entries, so a
/// scene with more images than that evicts mid-compile. Every image must still
/// be the one its own payload decoded to.
void everyImageDrawsItsOwnPayload() {
  constexpr int kCount = 40;
  constexpr int kCell = 8;
  std::vector<std::string> strings;
  Writer w;
  w.push(kCount);
  for (int i = 0; i < kCount; i++) {
    strings.push_back(imagePayload(cellColor(i)));
    w.push(7);  // Image
    w.pushAnim((i % kCell) * kCell);
    w.pushAnim((i / kCell) * kCell);
    w.pushAnim(kCell);
    w.pushAnim(kCell);
    w.push(i);
    w.push(0);  // fit: stretch to the rect
    w.pushAnim(1);
  }
  CHECK(!strings[0].empty());
  auto pixels = render(w.finish(), strings, {});
  for (int i = 0; i < kCount; i++) {
    auto color = cellColor(i);
    size_t at = (static_cast<size_t>((i / kCell) * kCell + kCell / 2) * kWidth +
                 (i % kCell) * kCell + kCell / 2) *
                4;
    CHECK(pixels[at] == color[0] && pixels[at + 1] == color[1] &&
          pixels[at + 2] == color[2]);
  }
}

/// Eviction drops the single oldest entry, so a scene whose images are all
/// still resident re-decodes none of them; a wholesale flush re-decodes all 32.
/// Nothing about that is visible in the pixels, so it is counted instead.
void aResidentSceneIsNotReDecoded() {
  constexpr int kBound = 32;
  std::vector<std::string> strings;
  for (int i = 0; i < kBound * 2 + 1; i++) {
    strings.push_back(imagePayload(cellColor(i)));
  }
  CHECK(!strings[0].empty());
  tgfxrn::SceneRenderer renderer;
  auto compile = [&](int from, int to) {
    Writer w;
    w.push(to - from);
    for (int i = from; i < to; i++) {
      w.push(7);  // Image
      w.pushAnim(0);
      w.pushAnim(0);
      w.pushAnim(8);
      w.pushAnim(8);
      w.push(i);
      w.push(0);
      w.pushAnim(1);
    }
    renderer.setScene(w.finish(), strings);
  };

  compile(0, kBound);
  CHECK(renderer.decodeCount() == kBound);
  // One image past the bound: only that one decodes, and only image 0 leaves.
  compile(0, kBound + 1);
  CHECK(renderer.decodeCount() == kBound + 1);
  // Everything except image 0 is still cached, so this subset decodes nothing.
  compile(1, kBound + 1);
  CHECK(renderer.decodeCount() == kBound + 1);
  // The bound still holds: a full turnover really does drop the originals.
  compile(kBound + 1, kBound * 2 + 1);
  compile(1, kBound + 1);
  CHECK(renderer.decodeCount() == kBound * 3 + 1);
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
  everyImageDrawsItsOwnPayload();
  aResidentSceneIsNotReDecoded();
  std::printf(failures == 0 ? "SceneTest: ok\n" : "SceneTest: %d failure(s)\n",
              failures);
  return failures == 0 ? 0 : 1;
}
