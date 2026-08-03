#include "TgfxScene.hpp"

#include <algorithm>
#include <cmath>
#include <iterator>

#include "ImageRegistry.hpp"
#include "Log.hpp"
#include "SvgPath.hpp"
#include "tgfx/core/Canvas.h"
#include "tgfx/core/Color.h"
#include "tgfx/core/Font.h"
#include "tgfx/core/Image.h"
#include "tgfx/core/Paint.h"
#include "tgfx/core/Point.h"
#include "tgfx/core/RRect.h"
#include "tgfx/core/Rect.h"
#include "tgfx/core/SamplingOptions.h"
#include "tgfx/core/Shader.h"
#include "tgfx/core/Stroke.h"
#include "tgfx/core/TileMode.h"
#include "tgfx/core/Typeface.h"

namespace tgfxrn {

/// Cursor over the binary draw program written by src/compiler/writer.ts.
///
/// Fields are read strictly in write order, so resolving an animated field is a
/// pointer bump: the patch table lists word indices in increasing order, and
/// `patchAt` walks it alongside the read cursor.
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

  double next() {
    if (at >= words.size()) {
      ok = false;
      return 0;
    }
    return words[at++];
  }

  int nextInt() {
    return static_cast<int>(next());
  }

  AnimF nextAnim() {
    AnimF f;
    if (patchAt + 1 < patches.size() &&
        static_cast<size_t>(patches[patchAt]) == at) {
      f.slot = static_cast<int>(patches[patchAt + 1]);
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

/// Bounds readNode and so drawCmd too; DrawCmd is 504 B, so 256 deep is ~129 KB of stack.
constexpr int kMaxNodeDepth = 256;

/// Node kinds, mirrored from src/compiler/writer.ts.
enum Kind {
  KGroup = 0, KRect, KRRect, KOval, KCircle, KLine, KPath, KImage, KText, KFill
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

tgfx::TileMode tileModeOf(int code) {
  switch (code) {
    case 1: return tgfx::TileMode::Repeat;
    case 2: return tgfx::TileMode::Mirror;
    case 3: return tgfx::TileMode::Decal;
    default: return tgfx::TileMode::Clamp;
  }
}

/// The source and destination rects `fit` implies, centered in their bounds.
///
/// This is Flutter's applyBoxFit + inscribe, which is what Skia's `<Image fit>`
/// and `<ImageShader fit>` implement — so `cover` crops the *source* instead of
/// overflowing the destination, and no clip is needed to contain it.
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
      // Fill, clamped so the image is never drawn larger than it is.
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

/// The registry image for `handle`, mipmapped when the sampling asks for it.
/// `external` reports a hardware-buffer handle, whose image the caller must
/// re-resolve every frame instead of caching.
///
/// Never decodes: the registry schedules that off-thread and moves its epoch
/// when it lands, so this is safe to call from a render thread.
std::shared_ptr<tgfx::Image> resolveImage(int handle,
                                          const tgfx::SamplingOptions& sampling,
                                          bool* external = nullptr) {
  // An integer lookup into the registry, not a hash of the payload: a re-commit
  // of an unchanged scene costs nothing here, and a hash collision cannot draw
  // somebody else's bitmap.
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
  colors.reserve(static_cast<size_t>(std::max(0, colorCount)));
  for (int i = 0; i < colorCount && r.ok; i++) {
    colors.push_back(colorFromPacked(static_cast<uint32_t>(r.next())));
  }
  int positionCount = r.nextInt();
  positions.reserve(static_cast<size_t>(std::max(0, positionCount)));
  for (int i = 0; i < positionCount && r.ok; i++) {
    positions.push_back(static_cast<float>(r.next()));
  }
}

// ---------------- per-frame helpers (render thread) ----------------

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

void applyPaint(const PaintCmd& pc, std::span<const double> v,
                tgfx::Paint& paint) {
  paint.reset();
  tgfx::Color color = colorFromPacked(pc.color);
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
  } else {
    paint.setStyle(tgfx::PaintStyle::Fill);
  }
  paint.setAntiAlias(pc.antiAlias);
  paint.setAlpha(color.alpha * pc.alpha.resolve(v));
}

}  // namespace

std::shared_ptr<tgfx::Shader> RuntimeShaderCmd::build(
    std::span<const double> values) const {
  auto resolved = uniforms;
  size_t at = 0;
  for (auto& uniform : resolved) {
    for (auto& value : uniform.values) {
      value = slots[at++].resolve(values);
    }
  }
  return tgfx::Shader::MakeRuntimeShader(body, std::move(resolved));
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

std::shared_ptr<tgfx::Typeface> SceneRenderer::getTypeface(
    const std::string& family) {
  auto it = typefaceCache_.find(family);
  if (it != typefaceCache_.end()) {
    return it->second;
  }
  std::shared_ptr<tgfx::Typeface> typeface;
  const char* names[] = {"", "sans-serif", "Helvetica", "Arial", "Roboto"};
  if (!family.empty()) {
    typeface = tgfx::Typeface::MakeFromName(family, "");
  }
  for (size_t i = 0; typeface == nullptr && i < std::size(names); i++) {
    typeface = tgfx::Typeface::MakeFromName(names[i], "");
  }
  const char* paths[] = {"/system/fonts/Roboto-Regular.ttf",
                         "/system/fonts/NotoSans-Regular.ttf",
                         "/system/fonts/DroidSans.ttf"};
  for (size_t i = 0; typeface == nullptr && i < std::size(paths); i++) {
    typeface = tgfx::Typeface::MakeFromPath(paths[i]);
  }
  if (typeface == nullptr) {
    TGFXRN_LOGW("no typeface found for family '%s'", family.c_str());
  }
  typefaceCache_[family] = typeface;
  return typeface;
}

void SceneRenderer::clearCaches() {
  std::lock_guard<std::mutex> lock(programMutex_);
  program_ = nullptr;
  typefaceCache_.clear();
}

std::shared_ptr<tgfx::Shader> SceneRenderer::readShader(SceneReader& r, PaintCmd* out) {
  int kind = r.nextInt();
  if (kind < 0) {
    return nullptr;
  }
  if (kind == 6) {
    std::string body = r.nextString();
    int uniformCount = r.nextInt();
    std::vector<tgfx::RuntimeShaderUniform> uniforms;
    uniforms.reserve(static_cast<size_t>(std::max(0, uniformCount)));
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
    if (animated && out != nullptr) {
      auto cmd = std::make_shared<RuntimeShaderCmd>();
      cmd->body = body;
      cmd->uniforms = uniforms;
      cmd->slots = std::move(slots);
      out->runtime = std::move(cmd);
    }
    return tgfx::Shader::MakeRuntimeShader(std::move(body), std::move(uniforms));
  }
  if (kind == 7) {
    // <ImageShader>: an image as the paint source for any shape.
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
      // Baking the shader here would freeze whatever the registry happened to
      // hold at compile time: the first camera frame for a hardware buffer, and
      // nothing at all for an asset the byte budget had dropped.
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

void SceneRenderer::readPaint(SceneReader& r, PaintCmd& paint) {
  paint.color = static_cast<uint32_t>(r.next());
  int flags = r.nextInt();
  paint.stroke = (flags & 1) != 0;
  paint.antiAlias = (flags & 2) != 0;
  paint.strokeWidth = r.nextAnim();
  paint.cap = r.nextInt();
  paint.join = r.nextInt();
  paint.alpha = r.nextAnim();
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
    case KGroup: {
      cmd.kind = DrawCmd::Group;
      int opCount = r.nextInt();
      cmd.ops.reserve(static_cast<size_t>(std::max(0, opCount)));
      bool animated = false;
      for (int i = 0; i < opCount && r.ok; i++) {
        TransformOpCmd op;
        op.type = r.nextInt();
        op.a = r.nextAnim();
        op.b = r.nextAnim();
        animated = animated || op.a.slot >= 0 || op.b.slot >= 0;
        cmd.ops.push_back(op);
      }
      // No slot in the ops => the matrix can never change, so fold it here.
      if (!animated && !cmd.ops.empty()) {
        cmd.hasMatrix = true;
        cmd.matrix = matrixFromOps(cmd.ops, {});
      }
      int childCount = r.nextInt();
      cmd.children.reserve(static_cast<size_t>(std::max(0, childCount)));
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
      // No geometry: it covers whatever the clip is at draw time.
      cmd.kind = DrawCmd::Fill;
      break;
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
    case KPath:
      cmd.kind = DrawCmd::Path;
      cmd.path = parseSvgPath(r.nextString());
      break;
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
      // The handle is always carried: `cmd.image` is only a cache of what the
      // registry could give us at compile time, and it is empty in two cases
      // that both have to keep drawing — a hardware buffer, whose image changes
      // between frames, and an asset the byte budget had dropped, whose
      // re-decode lands later.
      cmd.imageHandle = handle;
      bool external = false;
      cmd.image = resolveImage(handle, cmd.sampling, &external);
      if (external) {
        // Caching it would pin the producer's buffer and freeze the first frame
        // on screen; the draw path re-resolves the handle instead.
        cmd.image = nullptr;
      }
      break;
    }
    case KText: {
      cmd.kind = DrawCmd::Text;
      cmd.x = r.nextAnim();
      cmd.y = r.nextAnim();
      cmd.text = r.nextString();
      cmd.fontSize = r.nextAnim();
      auto typeface = getTypeface(r.nextString());
      if (typeface != nullptr) {
        // An animated size writes a 0 literal, and a 0-sized font has no typeface.
        float size = cmd.fontSize.slot >= 0 ? 1.0f : cmd.fontSize.literal;
        cmd.font.emplace(std::move(typeface), size);
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
  auto total = static_cast<size_t>(words[1]);
  auto patchStart = static_cast<size_t>(words[2]);
  if (total > words.size() || patchStart + 1 > total) {
    TGFXRN_LOGW("draw program is truncated");
    return;
  }
  auto patchCount = static_cast<size_t>(words[patchStart]);
  if (patchStart + 1 + patchCount * 2 > total) {
    TGFXRN_LOGW("draw program patch table is truncated");
    return;
  }
  SceneReader reader(words.first(patchStart),
                     words.subspan(patchStart + 1, patchCount * 2), strings);

  auto program = std::make_shared<Program>();
  int rootCount = reader.nextInt();
  program->reserve(static_cast<size_t>(std::max(0, rootCount)));
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
    // Anything unread means the writer and this reader disagree on a field.
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
    // A group's only canvas state is its transform (opacity folds at compile time).
    bool transformed = cmd.hasMatrix || !cmd.ops.empty();
    if (transformed) {
      canvas->save();
      canvas->concat(cmd.hasMatrix ? cmd.matrix : matrixFromOps(cmd.ops, v));
    }
    for (const auto& child : cmd.children) {
      drawCmd(canvas, child, v, paint);
    }
    if (transformed) {
      canvas->restore();
    }
    return;
  }

  // Only alpha and strokeWidth can move per frame; everything else in the paint
  // was fixed at setScene, so a static paint is handed over untouched.
  const tgfx::Paint* p = &cmd.paint.cached;
  if (cmd.paint.animated()) {
    applyPaint(cmd.paint, v, paint);
    p = &paint;
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
      canvas->drawPath(cmd.path, *p);
      break;
    case DrawCmd::Image: {
      // An image resolved at setScene is used straight from the cache and costs
      // nothing. The two that could not be cached — a hardware buffer, and an
      // asset evicted before the scene compiled — are resolved here, per frame,
      // because for both the answer changes with no re-commit behind it.
      std::shared_ptr<tgfx::Image> live;
      if (cmd.image == nullptr && cmd.imageHandle != 0) {
        live = resolveImage(cmd.imageHandle, cmd.sampling);
      }
      const auto& image = cmd.image != nullptr ? cmd.image : live;
      if (image == nullptr || image->width() <= 0) {
        break;
      }
      // `fit` crops the source rather than overflowing the destination, so this
      // needs no clip and no save/restore even for cover.
      auto source = cmd.srcRect.isEmpty()
                        ? tgfx::Rect::MakeWH(static_cast<float>(image->width()),
                                             static_cast<float>(image->height()))
                        : cmd.srcRect;
      auto fitted = fitRects(cmd.fit, source, rectOf(cmd, v));
      canvas->drawImageRect(image, fitted.src, fitted.dst, cmd.sampling, p);
      break;
    }
    case DrawCmd::Text:
      if (cmd.font.has_value() && !cmd.text.empty()) {
        float x = cmd.x.resolve(v), y = cmd.y.resolve(v);
        if (cmd.fontSize.slot >= 0) {
          tgfx::Font sized = *cmd.font;
          sized.setSize(cmd.fontSize.resolve(v));
          canvas->drawSimpleText(cmd.text, x, y, sized, *p);
        } else {
          canvas->drawSimpleText(cmd.text, x, y, *cmd.font, *p);
        }
      }
      break;
    default:
      break;
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
  // Scratch for the commands whose paint actually moves; the rest use their own.
  tgfx::Paint paint;
  for (const auto& cmd : *program) {
    drawCmd(canvas, cmd, values, paint);
  }
}

}  // namespace tgfxrn
