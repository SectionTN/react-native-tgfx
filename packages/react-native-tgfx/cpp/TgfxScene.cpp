#include "TgfxScene.hpp"

#include <algorithm>
#include <cmath>
#include <iterator>

#include "Base64.hpp"
#include "Log.hpp"
#include "SvgPath.hpp"
#include "tgfx/core/Canvas.h"
#include "tgfx/core/Color.h"
#include "tgfx/core/Data.h"
#include "tgfx/core/Font.h"
#include "tgfx/core/Image.h"
#include "tgfx/core/Paint.h"
#include "tgfx/core/Point.h"
#include "tgfx/core/RRect.h"
#include "tgfx/core/Rect.h"
#include "tgfx/core/SamplingOptions.h"
#include "tgfx/core/Shader.h"
#include "tgfx/core/Stroke.h"
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

constexpr double kSceneVersion = 3;

/// Bounds readNode and so drawCmd too; DrawCmd is 352 B, so 256 deep is ~90 KB of stack.
constexpr int kMaxNodeDepth = 256;

/// Node kinds, mirrored from src/compiler/writer.ts.
enum Kind { KGroup = 0, KRect, KRRect, KOval, KCircle, KLine, KPath, KImage, KText };

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
  if (pc.shader != nullptr) {
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

std::shared_ptr<tgfx::Image> SceneRenderer::getImage(const std::string& base64) {
  size_t key = std::hash<std::string>{}(base64);
  auto it = imageCache_.find(key);
  if (it != imageCache_.end()) {
    return it->second;
  }
  auto bytes = base64Decode(base64);
  std::shared_ptr<tgfx::Image> image;
  if (!bytes.empty()) {
    auto data = tgfx::Data::MakeWithCopy(bytes.data(), bytes.size());
    image = tgfx::Image::MakeFromEncoded(std::move(data));
  }
  if (image == nullptr) {
    TGFXRN_LOGW("failed to decode image (%zu base64 chars)", base64.size());
  }
  // Bound the cache so a long-lived view doesn't accumulate every image shown.
  if (imageCache_.size() >= 32) {
    imageCache_.clear();
  }
  imageCache_[key] = image;
  return image;
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
  clearResourceCaches();
}

void SceneRenderer::clearResourceCaches() {
  imageCache_.clear();
  typefaceCache_.clear();
}

std::shared_ptr<tgfx::Shader> SceneRenderer::readShader(SceneReader& r) {
  int kind = r.nextInt();
  if (kind < 0) {
    return nullptr;
  }
  if (kind == 6) {
    std::string body = r.nextString();
    int uniformCount = r.nextInt();
    std::vector<tgfx::RuntimeShaderUniform> uniforms;
    uniforms.reserve(static_cast<size_t>(std::max(0, uniformCount)));
    for (int i = 0; i < uniformCount && r.ok; i++) {
      tgfx::RuntimeShaderUniform uniform;
      uniform.name = r.nextString();
      int size = r.nextInt();
      for (int v = 0; v < size && r.ok; v++) {
        uniform.values.push_back(static_cast<float>(r.next()));
      }
      if (!uniform.name.empty() && !uniform.values.empty()) {
        uniforms.push_back(std::move(uniform));
      }
    }
    return tgfx::Shader::MakeRuntimeShader(std::move(body), std::move(uniforms));
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
  paint.strokeWidth = AnimF{static_cast<float>(r.next()), -1};
  paint.cap = r.nextInt();
  paint.join = r.nextInt();
  paint.alpha = r.nextAnim();
  paint.shader = readShader(r);
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
      break;
    case KPath:
      cmd.kind = DrawCmd::Path;
      cmd.path = parseSvgPath(r.nextString());
      break;
    case KImage: {
      // Images draw with the default paint, so only the alpha is carried.
      cmd.kind = DrawCmd::Image;
      cmd.x = r.nextAnim();
      cmd.y = r.nextAnim();
      cmd.w = r.nextAnim();
      cmd.h = r.nextAnim();
      cmd.image = getImage(r.nextString());
      cmd.fit = r.nextInt();
      cmd.paint.alpha = r.nextAnim();
      return r.ok;
    }
    case KText: {
      cmd.kind = DrawCmd::Text;
      cmd.x = r.nextAnim();
      cmd.y = r.nextAnim();
      cmd.text = r.nextString();
      cmd.fontSize = r.nextAnim();
      cmd.typeface = getTypeface(r.nextString());
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

  applyPaint(cmd.paint, v, paint);

  switch (cmd.kind) {
    case DrawCmd::Rect:
      canvas->drawRect(rectOf(cmd, v), paint);
      break;
    case DrawCmd::RRect:
      canvas->drawRRect(
          tgfx::RRect::MakeRectXY(rectOf(cmd, v), cmd.rx.resolve(v),
                                  cmd.ry.resolve(v)),
          paint);
      break;
    case DrawCmd::Oval:
      canvas->drawOval(rectOf(cmd, v), paint);
      break;
    case DrawCmd::Circle:
      canvas->drawCircle(cmd.cx.resolve(v), cmd.cy.resolve(v), cmd.r.resolve(v),
                         paint);
      break;
    case DrawCmd::Line: {
      if (paint.getStyle() != tgfx::PaintStyle::Stroke) {
        paint.setStyle(tgfx::PaintStyle::Stroke);
      }
      tgfx::Path line;
      line.moveTo(cmd.x1.resolve(v), cmd.y1.resolve(v));
      line.lineTo(cmd.x2.resolve(v), cmd.y2.resolve(v));
      canvas->drawPath(line, paint);
      break;
    }
    case DrawCmd::Path:
      canvas->drawPath(cmd.path, paint);
      break;
    case DrawCmd::Image: {
      if (cmd.image == nullptr || cmd.image->width() <= 0) {
        break;
      }
      float x = cmd.x.resolve(v), y = cmd.y.resolve(v);
      float w = cmd.w.resolve(v), h = cmd.h.resolve(v);
      tgfx::SamplingOptions sampling(tgfx::FilterMode::Linear);
      if (cmd.fit == 0) {
        canvas->drawImageRect(cmd.image, tgfx::Rect::MakeXYWH(x, y, w, h),
                              sampling, &paint);
      } else {
        float iw = static_cast<float>(cmd.image->width());
        float ih = static_cast<float>(cmd.image->height());
        float scale =
            (cmd.fit == 2) ? std::max(w / iw, h / ih) : std::min(w / iw, h / ih);
        float sw = iw * scale, sh = ih * scale;
        float dx = x + (w - sw) / 2, dy = y + (h - sh) / 2;
        bool clip = (cmd.fit == 2);
        if (clip) {
          canvas->save();
          canvas->clipRect(tgfx::Rect::MakeXYWH(x, y, w, h));
        }
        canvas->drawImageRect(cmd.image, tgfx::Rect::MakeXYWH(dx, dy, sw, sh),
                              sampling, &paint);
        if (clip) {
          canvas->restore();
        }
      }
      break;
    }
    case DrawCmd::Text:
      if (cmd.typeface != nullptr && !cmd.text.empty()) {
        tgfx::Font font(cmd.typeface, cmd.fontSize.resolve(v));
        canvas->drawSimpleText(cmd.text, cmd.x.resolve(v), cmd.y.resolve(v),
                               font, paint);
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
  // One Paint reused across the whole pass (applyPaint resets it per command).
  tgfx::Paint paint;
  for (const auto& cmd : *program) {
    drawCmd(canvas, cmd, values, paint);
  }
}

}  // namespace tgfxrn
