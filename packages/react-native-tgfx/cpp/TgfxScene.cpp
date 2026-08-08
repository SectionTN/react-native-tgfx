#include "TgfxScene.hpp"

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <iterator>
#include <limits>

#include "FontRegistry.hpp"
#include "ImageRegistry.hpp"
#include "Log.hpp"
#include "SvgPath.hpp"
#include "TextLayout.hpp"
#include "tgfx/core/Canvas.h"
#include "tgfx/core/Color.h"
#include "tgfx/core/ColorFilter.h"
#include "tgfx/core/Image.h"
#include "tgfx/core/ImageFilter.h"
#include "tgfx/core/Paint.h"
#include "tgfx/core/PathEffect.h"
#include "tgfx/core/Point.h"
#include "tgfx/core/RRect.h"
#include "tgfx/core/Rect.h"
#include "tgfx/core/SamplingOptions.h"
#include "tgfx/core/Shader.h"
#include "tgfx/core/Stroke.h"
#include "tgfx/core/Surface.h"
#include "tgfx/core/TileMode.h"
#include "tgfx/core/TextBlob.h"

namespace tgfxrn {

/// Cursor over the binary draw program from src/compiler/writer.ts; fields are read in write order.
struct SceneReader {
  SceneReader(std::span<const double> words, std::span<const double> patches,
              const std::vector<std::string>& strings)
      : words(words), patches(patches), strings(strings) {}

  std::span<const double> words;
  std::span<const double> patches;
  const std::vector<std::string>& strings;
  size_t at = 3;  // past the header
  size_t patchAt = 0;
  bool ok = true;

  size_t remaining() const {
    return at < words.size() ? words.size() - at : 0;
  }

  double next() {
    if (at >= words.size()) {
      ok = false;
      return 0;
    }
    return words[at++];
  }

  int nextInt() {
    double v = next();
    // Casting a NaN or out-of-range double to int is undefined behaviour.
    if (!(v >= std::numeric_limits<int>::min() &&
          v <= std::numeric_limits<int>::max())) {
      ok = false;
      return 0;
    }
    return static_cast<int>(v);
  }

  AnimF nextAnim() {
    AnimF f;
    // Compared as a double: casting a NaN or negative wire value to size_t is UB.
    if (patchAt + 1 < patches.size() &&
        patches[patchAt] == static_cast<double>(at)) {
      double slot = patches[patchAt + 1];
      f.slot = slot >= 0 && slot <= std::numeric_limits<int>::max()
                   ? static_cast<int>(slot)
                   : -1;
      patchAt += 2;
    }
    f.literal = static_cast<float>(next());
    return f;
  }

  const std::string& nextString() {
    static const std::string kEmpty;
    int index = nextInt();
    if (index < 0 || static_cast<size_t>(index) >= strings.size()) {
      ok = false;
      return kEmpty;
    }
    return strings[static_cast<size_t>(index)];
  }
};

namespace {

/// Bounds readNode and so drawCmd too; its frame is ~928 B, so 256 deep is ~232 KiB of stack.
constexpr int kMaxNodeDepth = 256;

/// A wire count clamped to the buffer; reserving on the raw value asks for terabytes.
size_t boundedCount(const SceneReader& r, int count) {
  return std::min(static_cast<size_t>(std::max(0, count)), r.remaining());
}

std::atomic<size_t> gFilterBuilds{0};

/// Node kinds, mirrored from src/compiler/writer.ts.
enum Kind {
  KGroup = 0, KRect, KRRect, KOval, KCircle, KLine, KPath, KImage, KText, KFill,
  KTextPath, KCameraFrame, KGlyphs, KGroupLayer
};

/// Sampling codes, mirrored from src/compiler/writer.ts.
tgfx::SamplingOptions samplingOf(int code) {
  switch (code) {
    case 0:
      return tgfx::SamplingOptions(tgfx::FilterMode::Nearest, tgfx::MipmapMode::None);
    case 2:
      // Mipmaps also need Image::makeMipmapped(); the filter alone does nothing.
      return tgfx::SamplingOptions(tgfx::FilterMode::Linear, tgfx::MipmapMode::Linear);
    default:
      return tgfx::SamplingOptions(tgfx::FilterMode::Linear, tgfx::MipmapMode::None);
  }
}

/// Blend modes travel as the index into tgfx's enum; BLEND_MODES mirrors that list.
tgfx::BlendMode blendModeOf(int code) {
  constexpr int kLast = static_cast<int>(tgfx::BlendMode::PlusDarker);
  if (code < 0 || code > kLast) {
    return tgfx::BlendMode::SrcOver;
  }
  return static_cast<tgfx::BlendMode>(code);
}

tgfx::TileMode tileModeOf(int code) {
  switch (code) {
    case 1: return tgfx::TileMode::Repeat;
    case 2: return tgfx::TileMode::Mirror;
    case 3: return tgfx::TileMode::Decal;
    default: return tgfx::TileMode::Clamp;
  }
}

/// Flutter's applyBoxFit + inscribe: `cover` crops the source, so no clip is needed.
struct FitRects {
  tgfx::Rect src;
  tgfx::Rect dst;
};

tgfx::Rect inscribe(float w, float h, const tgfx::Rect& bounds) {
  return tgfx::Rect::MakeXYWH(bounds.left + (bounds.width() - w) / 2,
                              bounds.top + (bounds.height() - h) / 2, w, h);
}

FitRects fitRects(Fit fit, const tgfx::Rect& source, const tgfx::Rect& dest) {
  float iw = source.width(), ih = source.height();
  float ow = dest.width(), oh = dest.height();
  if (iw <= 0 || ih <= 0 || ow <= 0 || oh <= 0) {
    return {source, dest};
  }
  // "Wider" in the Flutter sense: output aspect exceeds input aspect.
  bool wider = ow / oh > iw / ih;
  float sw = iw, sh = ih, dw = ow, dh = oh;
  switch (fit) {
    case Fit::Fill:
      break;
    case Fit::Contain:
      if (wider) {
        dw = iw * oh / ih;
      } else {
        dh = ih * ow / iw;
      }
      break;
    case Fit::Cover:
      if (wider) {
        sh = iw * oh / ow;
      } else {
        sw = ih * ow / oh;
      }
      break;
    case Fit::FitWidth:
      if (wider) {
        sh = iw * oh / ow;  // like cover
      } else {
        dh = ih * ow / iw;  // like contain
      }
      break;
    case Fit::FitHeight:
      if (wider) {
        dw = iw * oh / ih;  // like contain
      } else {
        sw = ih * ow / oh;  // like cover
      }
      break;
    case Fit::None:
      sw = dw = std::min(iw, ow);
      sh = dh = std::min(ih, oh);
      break;
    case Fit::ScaleDown:
      if (dh > ih) {
        dw = ih * (iw / ih);
        dh = ih;
      }
      if (dw > iw) {
        dh = iw / (iw / ih);
        dw = iw;
      }
      break;
  }
  return {inscribe(sw, sh, source), inscribe(dw, dh, dest)};
}

/// Frame pixels to node coordinates, so an overlay in frame pixels cannot drift.
tgfx::Matrix cameraMatrix(const DrawCmd& cmd, tgfx::Canvas* canvas, float w, float h) {
  tgfx::Matrix m = tgfx::Matrix::I();
  if (cmd.mirror) {
    m.postScale(-1, 1);
    m.postTranslate(w, 0);
  }
  int turns = cmd.quarterTurns & 3;
  if (turns != 0) {
    m.postRotate(static_cast<float>(turns * 90));
    // Rotation alone puts the frame in a negative quadrant; slide it back.
    switch (turns) {
      case 1: m.postTranslate(h, 0); break;
      case 2: m.postTranslate(w, h); break;
      default: m.postTranslate(0, w); break;
    }
  }
  float ow = (turns & 1) != 0 ? h : w;
  float oh = (turns & 1) != 0 ? w : h;

  auto* surface = canvas->getSurface();
  auto dest = surface != nullptr
                  ? tgfx::Rect::MakeWH(static_cast<float>(surface->width()),
                                       static_cast<float>(surface->height()))
                  : tgfx::Rect::MakeWH(ow, oh);
  tgfx::Matrix inverse;
  if (canvas->getMatrix().invert(&inverse)) {
    inverse.mapRect(&dest);
  }
  auto fitted = fitRects(cmd.fit, tgfx::Rect::MakeWH(ow, oh), dest);
  if (fitted.src.width() <= 0 || fitted.src.height() <= 0) {
    return m;
  }
  // Draw the whole frame through the fit matrix, so cover overflows instead of scaling.
  m.postTranslate(-fitted.src.left, -fitted.src.top);
  m.postScale(fitted.dst.width() / fitted.src.width(),
              fitted.dst.height() / fitted.src.height());
  m.postTranslate(fitted.dst.left, fitted.dst.top);
  return m;
}

/// The registry image for `handle`. Never decodes, so a render thread may call it.
std::shared_ptr<tgfx::Image> resolveImage(int handle,
                                          const tgfx::SamplingOptions& sampling,
                                          bool* external = nullptr) {
  auto image = ImageRegistry::instance().acquire(handle, external);
  if (image == nullptr) {
    if (handle != 0) {
      TGFXRN_LOGW("image handle %d has no pixels (disposed, or re-decoding)", handle);
    }
    return nullptr;
  }
  if (sampling.mipmapMode != tgfx::MipmapMode::None) {
    // The sampling options alone are ignored unless the image carries mipmaps.
    auto mipmapped = image->makeMipmapped(true);
    if (mipmapped != nullptr) {
      return mipmapped;
    }
  }
  return image;
}

tgfx::Color colorFromPacked(uint32_t c) {
  uint8_t a = (c >> 24) & 0xff;
  uint8_t r = (c >> 16) & 0xff;
  uint8_t g = (c >> 8) & 0xff;
  uint8_t b = c & 0xff;
  return tgfx::Color::FromRGBA(r, g, b, a);
}

void readStops(SceneReader& r, std::vector<tgfx::Color>& colors,
               std::vector<float>& positions) {
  int colorCount = r.nextInt();
  colors.reserve(boundedCount(r, colorCount));
  for (int i = 0; i < colorCount && r.ok; i++) {
    colors.push_back(colorFromPacked(static_cast<uint32_t>(r.next())));
  }
  int positionCount = r.nextInt();
  positions.reserve(boundedCount(r, positionCount));
  for (int i = 0; i < positionCount && r.ok; i++) {
    positions.push_back(static_cast<float>(r.next()));
  }
}
tgfx::Rect rectOf(const DrawCmd& c, std::span<const double> v) {
  return tgfx::Rect::MakeXYWH(c.x.resolve(v), c.y.resolve(v), c.w.resolve(v),
                              c.h.resolve(v));
}

struct Affine {
  float a = 1, c = 0, e = 0, b = 0, d = 1, f = 0;
};

Affine multiply(const Affine& m1, const Affine& m2) {
  return Affine{m1.a * m2.a + m1.c * m2.b, m1.a * m2.c + m1.c * m2.d,
                m1.a * m2.e + m1.c * m2.f + m1.e, m1.b * m2.a + m1.d * m2.b,
                m1.b * m2.c + m1.d * m2.d, m1.b * m2.e + m1.d * m2.f + m1.f};
}

tgfx::Matrix matrixFromOps(const std::vector<TransformOpCmd>& ops,
                           std::span<const double> values) {
  Affine m;
  for (const auto& op : ops) {
    float a = op.a.resolve(values);
    float b = op.b.resolve(values);
    Affine o;
    switch (op.type) {
      case 0: o = Affine{1, 0, a, 0, 1, b}; break;
      case 1: o = Affine{a, 0, 0, 0, b, 0}; break;
      case 2: {
        float cs = std::cos(a), sn = std::sin(a);
        o = Affine{cs, -sn, 0, sn, cs, 0};
        break;
      }
      case 3: o = Affine{1, std::tan(a), 0, 0, 1, 0}; break;
      case 4: o = Affine{1, 0, 0, std::tan(a), 1, 0}; break;
      default: break;
    }
    m = multiply(m, o);
  }
  return tgfx::Matrix::MakeAll(m.a, m.c, m.e, m.b, m.d, m.f);
}

uint8_t channelOf(const AnimF& f, std::span<const double> v) {
  return static_cast<uint8_t>(std::clamp(f.resolve(v), 0.0f, 1.0f) * 255.0f +
                              0.5f);
}

void applyPaint(const PaintCmd& pc, std::span<const double> v,
                tgfx::Paint& paint) {
  paint.reset();
  tgfx::Color color =
      pc.animColor ? tgfx::Color::FromRGBA(channelOf(pc.rgba[0], v),
                                           channelOf(pc.rgba[1], v),
                                           channelOf(pc.rgba[2], v),
                                           channelOf(pc.rgba[3], v))
                   : colorFromPacked(pc.color);
  paint.setColor(color);
  if (pc.runtime != nullptr) {
    paint.setShader(pc.runtime->build(v));
  } else if (pc.imageShader != nullptr) {
    paint.setShader(pc.imageShader->build(
        resolveImage(pc.imageShader->handle, pc.imageShader->sampling)));
  } else if (pc.shader != nullptr) {
    paint.setShader(pc.shader);
  }
  if (pc.stroke) {
    paint.setStyle(tgfx::PaintStyle::Stroke);
    paint.setStrokeWidth(pc.strokeWidth.resolve(v));
    switch (pc.cap) {
      case 1: paint.setLineCap(tgfx::LineCap::Round); break;
      case 2: paint.setLineCap(tgfx::LineCap::Square); break;
      default: paint.setLineCap(tgfx::LineCap::Butt); break;
    }
    switch (pc.join) {
      case 1: paint.setLineJoin(tgfx::LineJoin::Round); break;
      case 2: paint.setLineJoin(tgfx::LineJoin::Bevel); break;
      default: paint.setLineJoin(tgfx::LineJoin::Miter); break;
    }
    paint.setMiterLimit(pc.miter);
  } else {
    paint.setStyle(tgfx::PaintStyle::Fill);
  }
  paint.setAntiAlias(pc.antiAlias);
  paint.setAlpha(color.alpha * pc.alpha.resolve(v));
  paint.setBlendMode(pc.blend);
  paint.setColorFilter(pc.colorFilter);
  paint.setImageFilter(pc.imageFilter);
}

}  // namespace

void PathEffectCmd::apply(tgfx::Path* path, std::span<const double> v) const {
  if (corner > 0) {
    if (auto effect = tgfx::PathEffect::MakeCorner(corner)) {
      effect->filterPath(path);
    }
  }
  if (dash) {
    if (auto effect = tgfx::PathEffect::MakeDash(intervals.data(),
                                                 static_cast<int>(intervals.size()),
                                                 phase.resolve(v))) {
      effect->filterPath(path);
    }
  }
  if (trim) {
    if (auto effect = tgfx::PathEffect::MakeTrim(start.resolve(v), end.resolve(v))) {
      effect->filterPath(path);
    }
  }
}

std::shared_ptr<tgfx::Shader> ChildShaderCmd::resolve(
    std::span<const double> values) const {
  if (image != nullptr) {
    return image->build(resolveImage(image->handle, image->sampling));
  }
  if (runtime != nullptr) {
    return runtime->build(values);
  }
  return shader;
}

std::shared_ptr<tgfx::Shader> RuntimeShaderCmd::build(
    std::span<const double> values) const {
  auto resolved = uniforms;
  size_t at = 0;
  for (auto& uniform : resolved) {
    for (auto& value : uniform.values) {
      value = slots[at++].resolve(values);
    }
  }
  std::vector<std::shared_ptr<tgfx::Shader>> resolvedChildren;
  resolvedChildren.reserve(children.size());
  for (const auto& child : children) {
    auto shader = child.resolve(values);
    if (shader == nullptr) {
      return nullptr;
    }
    resolvedChildren.push_back(std::move(shader));
  }
  return tgfx::Shader::MakeRuntimeShader(body, std::move(resolved), preamble,
                                         functionNames,
                                         std::move(resolvedChildren));
}

std::shared_ptr<tgfx::Shader> ImageShaderCmd::build(
    const std::shared_ptr<tgfx::Image>& image) const {
  if (image == nullptr) {
    return nullptr;
  }
  auto shader = tgfx::Shader::MakeImageShader(image, tileX, tileY, sampling);
  if (shader == nullptr || !hasRect) {
    return shader;
  }
  // The shader samples in image space, so `fit`/`rect` become its matrix.
  auto bounds = tgfx::Rect::MakeWH(static_cast<float>(image->width()),
                                   static_cast<float>(image->height()));
  auto fitted = fitRects(fit, bounds, rect);
  if (fitted.src.width() <= 0 || fitted.src.height() <= 0) {
    return shader;
  }
  auto matrix = tgfx::Matrix::MakeTrans(-fitted.src.left, -fitted.src.top);
  matrix.postScale(fitted.dst.width() / fitted.src.width(),
                   fitted.dst.height() / fitted.src.height());
  matrix.postTranslate(fitted.dst.left, fitted.dst.top);
  return shader->makeWithMatrix(matrix);
}

void SceneRenderer::readTextSpec(SceneReader& r, TextSpec& spec) {
  spec.family = r.nextString();
  spec.weight = r.nextInt();
  int style = r.nextInt();
  spec.italic = (style & 1) != 0;
  spec.fauxBold = (style & 2) != 0;
  spec.fauxItalic = (style & 4) != 0;
  spec.letterSpacing = static_cast<float>(r.next());
}

void SceneRenderer::readTextRuns(SceneReader& r, TextCmd& text) {
  int count = r.nextInt();
  if (count < 1 || count > kMaxTextRuns) {
    TGFXRN_LOGW("text node has %d runs, which is outside 1..%d", count, kMaxTextRuns);
    r.ok = false;
    text.runs.assign(1, TextRun{});
    return;
  }
  text.runs.resize(static_cast<size_t>(count));
  for (auto& run : text.runs) {
    run.text = r.nextString();
    run.family = r.nextString();
    run.weight = r.nextInt();
    // Not `!= 0`: 2 means "upright", which a bool would fold into "italic".
    run.italic = r.nextInt();
    run.letterSpacing = static_cast<float>(r.next());
    run.size = static_cast<float>(r.next());
    run.hasColor = r.nextInt() != 0;
    run.color = static_cast<uint32_t>(r.next());
  }
}

const TextLayout& TextCmd::resolve(float size) const {
  // Quantised: getScalerContext keys its cache on the raw float and never erases. See #145.
  size = std::round(size * 4) / 4;
  if (size == layoutSize) {
    return layout;
  }
  layoutSize = size;
  layout = !glyphs.empty() ? layoutGlyphs(glyphs, spec, size)
           : onPath          ? layoutTextOnPath(runs, spec, size, path)
                             : layoutText(runs, spec, size);
  return layout;
}

void SceneRenderer::clearCaches() {
  std::lock_guard<std::mutex> lock(programMutex_);
  program_ = nullptr;
}

std::shared_ptr<tgfx::Shader> SceneRenderer::readShader(SceneReader& r, PaintCmd* out,
                                                        int depth) {
  if (depth > kMaxNodeDepth) {
    r.ok = false;
    return nullptr;
  }
  int kind = r.nextInt();
  if (kind < 0) {
    return nullptr;
  }
  if (kind == 6) {
    std::string body = r.nextString();
    // File-scope helpers: GLSL ES has no nested functions.
    std::string preamble = r.nextString();
    int functionCount = r.nextInt();
    std::vector<std::string> functionNames;
    functionNames.reserve(boundedCount(r, functionCount));
    for (int i = 0; i < functionCount && r.ok; i++) {
      functionNames.push_back(r.nextString());
    }
    int uniformCount = r.nextInt();
    std::vector<tgfx::RuntimeShaderUniform> uniforms;
    uniforms.reserve(boundedCount(r, uniformCount));
    std::vector<AnimF> slots;
    bool animated = false;
    for (int i = 0; i < uniformCount && r.ok; i++) {
      tgfx::RuntimeShaderUniform uniform;
      uniform.name = r.nextString();
      int size = r.nextInt();
      std::vector<AnimF> uniformSlots;
      for (int v = 0; v < size && r.ok; v++) {
        AnimF f = r.nextAnim();
        uniform.values.push_back(f.literal);
        uniformSlots.push_back(f);
      }
      // Dropped uniforms must drop their slots too, or the flat run desyncs.
      if (!uniform.name.empty() && !uniform.values.empty()) {
        uniforms.push_back(std::move(uniform));
        for (const auto& f : uniformSlots) {
          animated = animated || f.slot >= 0;
          slots.push_back(f);
        }
      }
    }
    int childCount = r.nextInt();
    std::vector<ChildShaderCmd> children;
    children.reserve(boundedCount(r, childCount));
    bool dynamicChild = false;
    for (int i = 0; i < childCount && r.ok; i++) {
      ChildShaderCmd child;
      PaintCmd childPaint;
      child.shader = readShader(r, &childPaint, depth + 1);
      child.image = std::move(childPaint.imageShader);
      child.runtime = std::move(childPaint.runtime);
      dynamicChild = dynamicChild || child.dynamic();
      children.push_back(std::move(child));
    }
    if ((animated || dynamicChild) && out != nullptr) {
      auto cmd = std::make_shared<RuntimeShaderCmd>();
      cmd->body = body;
      cmd->preamble = preamble;
      cmd->functionNames = functionNames;
      cmd->uniforms = uniforms;
      cmd->slots = std::move(slots);
      cmd->children = std::move(children);
      out->runtime = std::move(cmd);
      return nullptr;
    }
    std::vector<std::shared_ptr<tgfx::Shader>> staticChildren;
    staticChildren.reserve(children.size());
    for (auto& child : children) {
      staticChildren.push_back(std::move(child.shader));
    }
    return tgfx::Shader::MakeRuntimeShader(std::move(body), std::move(uniforms),
                                           std::move(preamble),
                                           std::move(functionNames),
                                           std::move(staticChildren));
  }
  if (kind == 7) {
    ImageShaderCmd cmd;
    cmd.handle = r.nextInt();
    cmd.tileX = tileModeOf(r.nextInt());
    cmd.tileY = tileModeOf(r.nextInt());
    cmd.sampling = samplingOf(r.nextInt());
    cmd.hasRect = r.nextInt() != 0;
    if (cmd.hasRect) {
      float x = static_cast<float>(r.next());
      float y = static_cast<float>(r.next());
      float w = static_cast<float>(r.next());
      float h = static_cast<float>(r.next());
      cmd.rect = tgfx::Rect::MakeXYWH(x, y, w, h);
      cmd.fit = static_cast<Fit>(r.nextInt());
    }
    bool external = false;
    auto image = resolveImage(cmd.handle, cmd.sampling, &external);
    if ((external || image == nullptr) && cmd.handle != 0 && out != nullptr) {
      // Baking here would freeze whatever the registry held at compile time.
      out->imageShader = std::make_shared<ImageShaderCmd>(cmd);
      return nullptr;
    }
    return cmd.build(image);
  }
  if (kind == 4 || kind == 5) {
    float fx = static_cast<float>(r.next());
    float fy = static_cast<float>(r.next());
    int octaves = r.nextInt();
    float seed = static_cast<float>(r.next());
    return kind == 4 ? tgfx::Shader::MakeFractalNoise(fx, fy, octaves, seed)
                     : tgfx::Shader::MakeTurbulence(fx, fy, octaves, seed);
  }

  std::vector<tgfx::Color> colors;
  std::vector<float> positions;
  if (kind == 0) {
    auto start = tgfx::Point::Make(static_cast<float>(r.next()),
                                   static_cast<float>(r.next()));
    auto end = tgfx::Point::Make(static_cast<float>(r.next()),
                                 static_cast<float>(r.next()));
    readStops(r, colors, positions);
    if (colors.size() < 2) {
      return nullptr;
    }
    return tgfx::Shader::MakeLinearGradient(start, end, colors, positions);
  }
  auto center = tgfx::Point::Make(static_cast<float>(r.next()),
                                  static_cast<float>(r.next()));
  if (kind == 2) {
    float startAngle = static_cast<float>(r.next());
    float endAngle = static_cast<float>(r.next());
    readStops(r, colors, positions);
    if (colors.size() < 2) {
      return nullptr;
    }
    return tgfx::Shader::MakeConicGradient(center, startAngle, endAngle, colors,
                                           positions);
  }
  float radius = static_cast<float>(r.next());
  readStops(r, colors, positions);
  if (colors.size() < 2) {
    return nullptr;
  }
  return kind == 3
             ? tgfx::Shader::MakeDiamondGradient(center, radius, colors, positions)
             : tgfx::Shader::MakeRadialGradient(center, radius, colors, positions);
}

size_t filterBuildCount() {
  return gFilterBuilds.load(std::memory_order_relaxed);
}

void SceneRenderer::readFilters(SceneReader& r, PaintCmd& paint) {
  paint.blend = blendModeOf(r.nextInt());
  int colorKind = r.nextInt();
  if (colorKind == 0) {
    std::array<float, 20> matrix{};
    for (auto& value : matrix) {
      value = static_cast<float>(r.next());
    }
    paint.colorFilter = tgfx::ColorFilter::Matrix(matrix);
    gFilterBuilds++;
  } else if (colorKind == 1) {
    auto color = colorFromPacked(static_cast<uint32_t>(r.next()));
    paint.colorFilter = tgfx::ColorFilter::Blend(color, blendModeOf(r.nextInt()));
    gFilterBuilds++;
  }
  int imageKind = r.nextInt();
  if (imageKind == 0) {
    float blurX = static_cast<float>(r.next());
    float blurY = static_cast<float>(r.next());
    paint.imageFilter = tgfx::ImageFilter::Blur(blurX, blurY, tileModeOf(r.nextInt()));
    gFilterBuilds++;
  } else if (imageKind == 1) {
    float dx = static_cast<float>(r.next());
    float dy = static_cast<float>(r.next());
    float blurX = static_cast<float>(r.next());
    float blurY = static_cast<float>(r.next());
    auto color = colorFromPacked(static_cast<uint32_t>(r.next()));
    paint.imageFilter =
        r.nextInt() != 0
            ? tgfx::ImageFilter::DropShadowOnly(dx, dy, blurX, blurY, color)
            : tgfx::ImageFilter::DropShadow(dx, dy, blurX, blurY, color);
    gFilterBuilds++;
  }
  if (paint.imageFilter != nullptr && paint.blend != tgfx::BlendMode::SrcOver) {
    // Taking the layer here keeps the blend mode tgfx would otherwise composite away.
    paint.layer = std::make_shared<tgfx::Paint>();
    paint.layer->setBlendMode(paint.blend);
    paint.layer->setImageFilter(std::move(paint.imageFilter));
    paint.blend = tgfx::BlendMode::SrcOver;
    paint.imageFilter = nullptr;
  }
}

void SceneRenderer::readPaint(SceneReader& r, PaintCmd& paint) {
  paint.color = static_cast<uint32_t>(r.next());
  int flags = r.nextInt();
  paint.stroke = (flags & 1) != 0;
  paint.antiAlias = (flags & 2) != 0;
  // Bit 8: the colour is animated and travels as four live channels.
  paint.animColor = (flags & 8) != 0;
  if (paint.animColor) {
    for (auto& channel : paint.rgba) {
      channel = r.nextAnim();
    }
  }
  paint.strokeWidth = r.nextAnim();
  paint.cap = r.nextInt();
  paint.join = r.nextInt();
  // Bit 16: a miter limit other than tgfx's default of 4.
  paint.miter = (flags & 16) != 0 ? static_cast<float>(r.next()) : 4;
  paint.alpha = r.nextAnim();
  // Bit 4: the paint carries a filter block; unset costs no words at all.
  if ((flags & 4) != 0) {
    readFilters(r, paint);
  }
  paint.shader = readShader(r, &paint);
  applyPaint(paint, {}, paint.cached);
}

bool SceneRenderer::readNode(SceneReader& r, DrawCmd& cmd, int depth) {
  if (depth > kMaxNodeDepth) {
    r.ok = false;
    return false;
  }
  int kind = r.nextInt();
  if (!r.ok) {
    return false;
  }
  switch (kind) {
    case KGroup:
    case KGroupLayer: {
      cmd.kind = DrawCmd::Group;
      int opCount = r.nextInt();
      cmd.ops.reserve(boundedCount(r, opCount));
      bool animated = false;
      for (int i = 0; i < opCount && r.ok; i++) {
        TransformOpCmd op;
        op.type = r.nextInt();
        op.a = r.nextAnim();
        op.b = r.nextAnim();
        animated = animated || op.a.slot >= 0 || op.b.slot >= 0;
        cmd.ops.push_back(op);
      }
      if (!animated && !cmd.ops.empty()) {
        cmd.hasMatrix = true;
        cmd.matrix = matrixFromOps(cmd.ops, {});
      }
      // Only KGroupLayer carries the clip/layer block; a plain group is unchanged.
      if (kind == KGroupLayer) {
        int flags = r.nextInt();
        cmd.invertClip = (flags & 2) != 0;
        cmd.layer = (flags & 4) != 0;
        if ((flags & 1) != 0) {
          cmd.clipKind = r.nextInt();
          if (cmd.clipKind == 3) {
            cmd.clipPath = std::make_shared<tgfx::Path>(parseSvgPath(r.nextString()));
          } else {
            float x = static_cast<float>(r.next());
            float y = static_cast<float>(r.next());
            cmd.clipRect = tgfx::Rect::MakeXYWH(x, y, static_cast<float>(r.next()),
                                                static_cast<float>(r.next()));
            if (cmd.clipKind == 2) {
              cmd.clipRadiusX = static_cast<float>(r.next());
              cmd.clipRadiusY = static_cast<float>(r.next());
            }
          }
          if (cmd.invertClip && cmd.clipKind != 3) {
            // Only a path can carry an inverse fill, so a rect clip becomes one.
            tgfx::Path box;
            if (cmd.clipKind == 2) {
              box.addRRect(tgfx::RRect::MakeRectXY(cmd.clipRect, cmd.clipRadiusX,
                                                   cmd.clipRadiusY));
            } else {
              box.addRect(cmd.clipRect);
            }
            cmd.clipPath = std::make_shared<tgfx::Path>(std::move(box));
            cmd.clipKind = 3;
          }
          if (cmd.invertClip && cmd.clipPath != nullptr) {
            cmd.clipPath->toggleInverseFillType();
          }
        }
        if (cmd.layer) {
          cmd.layerAlpha = r.nextAnim();
        }
      }
      int childCount = r.nextInt();
      cmd.children.reserve(boundedCount(r, childCount));
      for (int i = 0; i < childCount && r.ok; i++) {
        DrawCmd child;
        if (!readNode(r, child, depth + 1)) {
          return false;
        }
        cmd.children.push_back(std::move(child));
      }
      return r.ok;
    }
    case KFill:
      cmd.kind = DrawCmd::Fill;
      break;
    case KCameraFrame: {
      // Like a group, but the transform comes from the live frame, with no re-commit.
      cmd.kind = DrawCmd::CameraFrame;
      cmd.imageHandle = r.nextInt();
      cmd.fit = static_cast<Fit>(r.nextInt());
      cmd.sampling = samplingOf(r.nextInt());
      cmd.quarterTurns = r.nextInt();
      cmd.mirror = r.nextInt() != 0;
      readPaint(r, cmd.paint);
      int childCount = r.nextInt();
      cmd.children.reserve(boundedCount(r, childCount));
      for (int i = 0; i < childCount && r.ok; i++) {
        DrawCmd child;
        if (!readNode(r, child, depth + 1)) {
          return false;
        }
        cmd.children.push_back(std::move(child));
      }
      return r.ok;
    }
    case KRect:
      cmd.kind = DrawCmd::Rect;
      cmd.x = r.nextAnim();
      cmd.y = r.nextAnim();
      cmd.w = r.nextAnim();
      cmd.h = r.nextAnim();
      break;
    case KRRect:
      cmd.kind = DrawCmd::RRect;
      cmd.x = r.nextAnim();
      cmd.y = r.nextAnim();
      cmd.w = r.nextAnim();
      cmd.h = r.nextAnim();
      cmd.rx = r.nextAnim();
      cmd.ry = r.nextAnim();
      break;
    case KOval:
      cmd.kind = DrawCmd::Oval;
      cmd.x = r.nextAnim();
      cmd.y = r.nextAnim();
      cmd.w = r.nextAnim();
      cmd.h = r.nextAnim();
      break;
    case KCircle:
      cmd.kind = DrawCmd::Circle;
      cmd.cx = r.nextAnim();
      cmd.cy = r.nextAnim();
      cmd.r = r.nextAnim();
      break;
    case KLine:
      cmd.kind = DrawCmd::Line;
      cmd.x1 = r.nextAnim();
      cmd.y1 = r.nextAnim();
      cmd.x2 = r.nextAnim();
      cmd.y2 = r.nextAnim();
      cmd.lineAnimated = cmd.x1.slot >= 0 || cmd.y1.slot >= 0 ||
                         cmd.x2.slot >= 0 || cmd.y2.slot >= 0;
      if (!cmd.lineAnimated) {
        cmd.path.moveTo(cmd.x1.literal, cmd.y1.literal);
        cmd.path.lineTo(cmd.x2.literal, cmd.y2.literal);
      }
      break;
    case KPath: {
      cmd.kind = DrawCmd::Path;
      cmd.path = parseSvgPath(r.nextString());
      int flags = r.nextInt();
      if ((flags & 8) != 0) {
        cmd.path.setFillType(tgfx::PathFillType::EvenOdd);
      }
      if ((flags & 7) != 0) {
        auto effects = std::make_shared<PathEffectCmd>();
        effects->trim = (flags & 1) != 0;
        if (effects->trim) {
          effects->start = r.nextAnim();
          effects->end = r.nextAnim();
        }
        if ((flags & 2) != 0) {
          int count = r.nextInt();
          effects->intervals.reserve(boundedCount(r, count));
          for (int i = 0; i < count && r.ok; i++) {
            effects->intervals.push_back(static_cast<float>(r.next()));
          }
          effects->dash = effects->intervals.size() >= 2;
          effects->phase = r.nextAnim();
        }
        if ((flags & 4) != 0) {
          effects->corner = static_cast<float>(r.next());
        }
        // A static effect is baked now, so the draw path stays a plain drawPath.
        if (effects->animated()) {
          cmd.effects = std::move(effects);
        } else {
          effects->apply(&cmd.path, {});
        }
      }
      break;
    }
    case KImage: {
      cmd.kind = DrawCmd::Image;
      cmd.x = r.nextAnim();
      cmd.y = r.nextAnim();
      cmd.w = r.nextAnim();
      cmd.h = r.nextAnim();
      int handle = r.nextInt();
      cmd.fit = static_cast<Fit>(r.nextInt());
      cmd.sampling = samplingOf(r.nextInt());
      if (r.nextInt() != 0) {
        float sx = static_cast<float>(r.next());
        float sy = static_cast<float>(r.next());
        float sw = static_cast<float>(r.next());
        float sh = static_cast<float>(r.next());
        cmd.srcRect = tgfx::Rect::MakeXYWH(sx, sy, sw, sh);
      }
      // `cmd.image` is only a compile-time cache, empty for a buffer or an evicted asset.
      cmd.imageHandle = handle;
      bool external = false;
      cmd.image = resolveImage(handle, cmd.sampling, &external);
      if (external) {
        cmd.image = nullptr;
      }
      break;
    }
    case KText: {
      cmd.kind = DrawCmd::Text;
      cmd.x = r.nextAnim();
      cmd.y = r.nextAnim();
      cmd.text = std::make_shared<TextCmd>();
      cmd.fontSize = r.nextAnim();
      readTextSpec(r, cmd.text->spec);
      readTextRuns(r, *cmd.text);
      auto& spec = cmd.text->spec;
      spec.wrapWidth = static_cast<float>(r.next());
      spec.align = static_cast<TextAlign>(std::clamp(r.nextInt(), 0, 2));
      spec.lineHeight = static_cast<float>(r.next());
      spec.maxLines = r.nextInt();
      spec.ellipsis = r.nextString();
      break;
    }
    case KTextPath: {
      // Same command as Text; the path is the baseline, so there is no x/y.
      cmd.kind = DrawCmd::Text;
      cmd.text = std::make_shared<TextCmd>();
      cmd.text->onPath = true;
      cmd.text->path = parseSvgPath(r.nextString());
      cmd.fontSize = r.nextAnim();
      readTextSpec(r, cmd.text->spec);
      readTextRuns(r, *cmd.text);
      cmd.text->spec.startOffset = static_cast<float>(r.next());
      break;
    }
    case KGlyphs: {
      cmd.kind = DrawCmd::Text;
      cmd.x = r.nextAnim();
      cmd.y = r.nextAnim();
      cmd.text = std::make_shared<TextCmd>();
      cmd.fontSize = r.nextAnim();
      readTextSpec(r, cmd.text->spec);
      int count = r.nextInt();
      if (count < 0 || count > kMaxGlyphs) {
        TGFXRN_LOGW("glyph node has %d glyphs, which is outside 0..%d", count, kMaxGlyphs);
        r.ok = false;
        break;
      }
      cmd.text->glyphs.resize(static_cast<size_t>(count));
      bool warnedId = false;
      for (auto& glyph : cmd.text->glyphs) {
        int id = r.nextInt();
        if (id < 0 || id > 0xFFFF) {
          if (!warnedId) {
            warnedId = true;
            TGFXRN_LOGW("glyph id %d is outside 0..65535; drawing .notdef", id);
          }
          id = 0;
        }
        glyph.id = static_cast<tgfx::GlyphID>(id);
        auto x = static_cast<float>(r.next());
        auto y = static_cast<float>(r.next());
        // A non-finite position poisons the whole blob's bounds.
        glyph.x = std::isfinite(x) ? x : 0;
        glyph.y = std::isfinite(y) ? y : 0;
      }
      break;
    }
    default:
      TGFXRN_LOGW("unknown node kind %d in draw program", kind);
      r.ok = false;
      return false;
  }
  readPaint(r, cmd.paint);
  return r.ok;
}

void SceneRenderer::setScene(std::span<const double> words,
                             const std::vector<std::string>& strings) {
  if (words.size() < 4 || words[0] != kSceneVersion) {
    TGFXRN_LOGW("draw program has an unexpected header");
    return;
  }
  // A NaN, negative or out-of-range JS double is not a size_t; bound by the buffer.
  auto index = [limit = static_cast<double>(words.size())](double v,
                                                           size_t& out) {
    if (!std::isfinite(v) || v < 0 || v > limit) {
      return false;
    }
    out = static_cast<size_t>(v);
    return true;
  };
  size_t total = 0;
  size_t patchStart = 0;
  if (!index(words[1], total) || !index(words[2], patchStart)) {
    TGFXRN_LOGW("draw program has an unexpected header");
    return;
  }
  if (total > words.size() || patchStart + 1 > total) {
    TGFXRN_LOGW("draw program is truncated");
    return;
  }
  size_t patchCount = 0;
  if (!index(words[patchStart], patchCount) ||
      patchStart + 1 + patchCount * 2 > total) {
    TGFXRN_LOGW("draw program patch table is truncated");
    return;
  }
  SceneReader reader(words.first(patchStart),
                     words.subspan(patchStart + 1, patchCount * 2), strings);

  auto program = std::make_shared<Program>();
  int rootCount = reader.nextInt();
  program->reserve(boundedCount(reader, rootCount));
  for (int i = 0; i < rootCount && reader.ok; i++) {
    DrawCmd cmd;
    if (!readNode(reader, cmd, 0)) {
      break;
    }
    program->push_back(std::move(cmd));
  }
  if (!reader.ok) {
    // A half-read program would draw a truncated scene; keep the previous one.
    TGFXRN_LOGW("draw program could not be read");
    return;
  }
  if (reader.at != reader.words.size() ||
      reader.patchAt != reader.patches.size()) {
    TGFXRN_LOGW("draw program not fully consumed: %zu/%zu words, %zu/%zu patch words",
                reader.at, reader.words.size(), reader.patchAt,
                reader.patches.size());
  }

  std::lock_guard<std::mutex> lock(programMutex_);
  program_ = std::move(program);
}

void SceneRenderer::drawCmd(tgfx::Canvas* canvas, const DrawCmd& cmd,
                            std::span<const double> v,
                            tgfx::Paint& paint) const {
  if (cmd.kind == DrawCmd::Group) {
    bool transformed = cmd.hasMatrix || !cmd.ops.empty();
    bool saved = transformed || cmd.clipKind != 0 || cmd.layer;
    if (saved) {
      canvas->save();
    }
    if (transformed) {
      canvas->concat(cmd.hasMatrix ? cmd.matrix : matrixFromOps(cmd.ops, v));
    }
    switch (cmd.clipKind) {
      case 1: canvas->clipRect(cmd.clipRect); break;
      case 2:
        canvas->clipRRect(
            tgfx::RRect::MakeRectXY(cmd.clipRect, cmd.clipRadiusX, cmd.clipRadiusY));
        break;
      case 3:
        if (cmd.clipPath != nullptr) {
          canvas->clipPath(*cmd.clipPath);
        }
        break;
      default: break;
    }
    if (cmd.layer) {
      canvas->saveLayerAlpha(cmd.layerAlpha.resolve(v));
    }
    for (const auto& child : cmd.children) {
      drawCmd(canvas, child, v, paint);
    }
    if (cmd.layer) {
      canvas->restore();
    }
    if (saved) {
      canvas->restore();
    }
    return;
  }

  if (cmd.kind == DrawCmd::CameraFrame) {
    // Never cached: the producer swaps the buffer behind the handle between frames.
    auto image = resolveImage(cmd.imageHandle, cmd.sampling);
    if (image == nullptr || image->width() <= 0 || image->height() <= 0) {
      return;
    }
    canvas->save();
    canvas->concat(cameraMatrix(cmd, canvas, static_cast<float>(image->width()),
                                static_cast<float>(image->height())));
    const tgfx::Paint* framePaint = &cmd.paint.cached;
    if (cmd.paint.animated()) {
      applyPaint(cmd.paint, v, paint);
      framePaint = &paint;
    }
    canvas->drawImage(std::move(image), cmd.sampling, framePaint);
    for (const auto& child : cmd.children) {
      drawCmd(canvas, child, v, paint);
    }
    canvas->restore();
    return;
  }

  // Only alpha and strokeWidth move per frame; a static paint is handed over untouched.
  const tgfx::Paint* p = &cmd.paint.cached;
  if (cmd.paint.animated()) {
    applyPaint(cmd.paint, v, paint);
    p = &paint;
  }
  // Replaces the layer tgfx would take for the image filter — the same one, not an extra.
  if (cmd.paint.layer != nullptr) {
    canvas->saveLayer(cmd.paint.layer.get());
  }

  switch (cmd.kind) {
    case DrawCmd::Fill:
      canvas->drawPaint(*p);
      break;
    case DrawCmd::Rect:
      canvas->drawRect(rectOf(cmd, v), *p);
      break;
    case DrawCmd::RRect:
      canvas->drawRRect(
          tgfx::RRect::MakeRectXY(rectOf(cmd, v), cmd.rx.resolve(v),
                                  cmd.ry.resolve(v)),
          *p);
      break;
    case DrawCmd::Oval:
      canvas->drawOval(rectOf(cmd, v), *p);
      break;
    case DrawCmd::Circle:
      canvas->drawCircle(cmd.cx.resolve(v), cmd.cy.resolve(v), cmd.r.resolve(v),
                         *p);
      break;
    case DrawCmd::Line:
      if (cmd.lineAnimated) {
        tgfx::Path line;
        line.moveTo(cmd.x1.resolve(v), cmd.y1.resolve(v));
        line.lineTo(cmd.x2.resolve(v), cmd.y2.resolve(v));
        canvas->drawPath(line, *p);
      } else {
        canvas->drawPath(cmd.path, *p);
      }
      break;
    case DrawCmd::Path:
      if (cmd.effects != nullptr) {
        tgfx::Path trimmed = cmd.path;
        cmd.effects->apply(&trimmed, v);
        canvas->drawPath(trimmed, *p);
      } else {
        canvas->drawPath(cmd.path, *p);
      }
      break;
    case DrawCmd::Image: {
      std::shared_ptr<tgfx::Image> live;
      if (cmd.image == nullptr && cmd.imageHandle != 0) {
        live = resolveImage(cmd.imageHandle, cmd.sampling);
      }
      const auto& image = cmd.image != nullptr ? cmd.image : live;
      if (image == nullptr || image->width() <= 0) {
        break;
      }
      // `fit` crops the source, so cover needs no clip and no save/restore.
      auto source = cmd.srcRect.isEmpty()
                        ? tgfx::Rect::MakeWH(static_cast<float>(image->width()),
                                             static_cast<float>(image->height()))
                        : cmd.srcRect;
      auto fitted = fitRects(cmd.fit, source, rectOf(cmd, v));
      canvas->drawImageRect(image, fitted.src, fitted.dst, cmd.sampling, p);
      break;
    }
    case DrawCmd::Text: {
      if (cmd.text == nullptr) {
        break;
      }
      const auto& layout = cmd.text->resolve(cmd.fontSize.resolve(v));
      float x = cmd.x.resolve(v);
      float y = cmd.y.resolve(v);
      for (const auto& run : layout.runs) {
        if (run.blob == nullptr) {
          continue;
        }
        if (!run.hasColor) {
          canvas->drawTextBlob(run.blob, x, y, *p);
          continue;
        }
        tgfx::Paint spanPaint = *p;
        spanPaint.setColor(tgfx::Color::FromRGBA(
            static_cast<uint8_t>((run.color >> 16) & 0xFF),
            static_cast<uint8_t>((run.color >> 8) & 0xFF), static_cast<uint8_t>(run.color & 0xFF),
            static_cast<uint8_t>((run.color >> 24) & 0xFF)));
        // The node's opacity, not its resolved alpha: the span colour replaces that.
        spanPaint.setAlpha(spanPaint.getAlpha() * cmd.paint.alpha.resolve(v));
        canvas->drawTextBlob(run.blob, x, y, spanPaint);
      }
      break;
    }
    default:
      break;
  }

  if (cmd.paint.layer != nullptr) {
    canvas->restore();
  }
}

void SceneRenderer::render(tgfx::Canvas* canvas,
                           std::span<const double> values) {
  std::shared_ptr<const Program> program;
  {
    std::lock_guard<std::mutex> lock(programMutex_);
    program = program_;
  }
  if (program == nullptr) {
    return;
  }
  tgfx::Paint paint;
  for (const auto& cmd : *program) {
    drawCmd(canvas, cmd, values, paint);
  }
}

}  // namespace tgfxrn
