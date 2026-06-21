#include "TgfxScene.hpp"

#include <algorithm>
#include <cmath>
#include <functional>
#include <iterator>

#include <nlohmann/json.hpp>

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

using json = nlohmann::json;

namespace {

// ---------------- compile helpers (scene-change thread only) ----------------

AnimF parseAnimF(const json& field, float def) {
  AnimF f;
  f.literal = def;
  if (field.is_number()) {
    f.literal = field.get<float>();
  } else if (field.is_object()) {
    auto it = field.find("__s");
    if (it != field.end() && it->is_number()) {
      f.slot = it->get<int>();
    }
  }
  return f;
}

AnimF getAnimF(const json& n, const char* key, float def) {
  auto it = n.find(key);
  if (it != n.end()) {
    return parseAnimF(*it, def);
  }
  AnimF f;
  f.literal = def;
  return f;
}

int getInt(const json& n, const char* key, int def) {
  auto it = n.find(key);
  if (it != n.end() && it->is_number()) {
    return it->get<int>();
  }
  return def;
}

tgfx::Color colorFromPacked(uint32_t c) {
  uint8_t a = (c >> 24) & 0xff;
  uint8_t r = (c >> 16) & 0xff;
  uint8_t g = (c >> 8) & 0xff;
  uint8_t b = c & 0xff;
  return tgfx::Color::FromRGBA(r, g, b, a);
}

std::shared_ptr<tgfx::Shader> buildShader(const json& g) {
  std::vector<tgfx::Color> colors;
  if (auto it = g.find("cs"); it != g.end() && it->is_array()) {
    for (const auto& c : *it) {
      colors.push_back(colorFromPacked(c.get<uint32_t>()));
    }
  }
  if (colors.size() < 2) {
    return nullptr;
  }
  std::vector<float> positions;
  if (auto it = g.find("ps"); it != g.end() && it->is_array()) {
    for (const auto& p : *it) {
      positions.push_back(p.get<float>());
    }
  }
  int kind = getInt(g, "k", 0);
  if (kind == 1) {
    return tgfx::Shader::MakeRadialGradient(
        tgfx::Point::Make(getAnimF(g, "cx", 0).literal,
                          getAnimF(g, "cy", 0).literal),
        getAnimF(g, "r", 0).literal, colors, positions);
  }
  return tgfx::Shader::MakeLinearGradient(
      tgfx::Point::Make(getAnimF(g, "sx", 0).literal,
                        getAnimF(g, "sy", 0).literal),
      tgfx::Point::Make(getAnimF(g, "ex", 0).literal,
                        getAnimF(g, "ey", 0).literal),
      colors, positions);
}

// ---------------- per-frame helpers (render thread) ----------------

tgfx::Rect rectOf(const DrawCmd& c, const std::vector<double>& v) {
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
                           const std::vector<double>& values) {
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

void applyPaint(const PaintCmd& pc, const std::vector<double>& v,
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
  imageCache_.clear();
  typefaceCache_.clear();
}

void SceneRenderer::setScene(const std::string& sceneJson) {
  json root;
  try {
    root = json::parse(sceneJson);
  } catch (...) {
    TGFXRN_LOGW("scene JSON parse failed");
    return;
  }
  auto rootIt = root.find("root");
  if (rootIt == root.end()) {
    return;
  }

  auto program = std::make_shared<Program>();

  // Recursive compile (explicit std::function is fine here — compile is rare).
  std::function<bool(const json&, DrawCmd&)> compile = [&](const json& n,
                                                           DrawCmd& cmd) -> bool {
    auto tIt = n.find("t");
    if (tIt == n.end() || !tIt->is_string()) {
      return false;
    }
    const std::string t = tIt->get<std::string>();

    if (t == "g") {
      cmd.kind = DrawCmd::Group;
      if (auto ops = n.find("ops"); ops != n.end() && ops->is_array()) {
        for (const auto& op : *ops) {
          auto opT = op.find("t");
          if (opT == op.end() || !opT->is_string()) {
            continue;
          }
          const std::string ot = opT->get<std::string>();
          TransformOpCmd tc;
          if (ot == "translate") {
            tc.type = 0;
            tc.a = getAnimF(op, "x", 0);
            tc.b = getAnimF(op, "y", 0);
          } else if (ot == "scale") {
            tc.type = 1;
            tc.a = getAnimF(op, "x", 1);
            tc.b = getAnimF(op, "y", 1);
          } else if (ot == "rotate") {
            tc.type = 2;
            tc.a = getAnimF(op, "r", 0);
          } else if (ot == "skewX") {
            tc.type = 3;
            tc.a = getAnimF(op, "v", 0);
          } else if (ot == "skewY") {
            tc.type = 4;
            tc.a = getAnimF(op, "v", 0);
          } else {
            continue;
          }
          cmd.ops.push_back(tc);
        }
      } else if (auto m = n.find("m");
                 m != n.end() && m->is_array() && m->size() == 6) {
        const auto& a = *m;
        cmd.hasMatrix = true;
        cmd.matrix = tgfx::Matrix::MakeAll(a[0].get<float>(), a[1].get<float>(),
                                           a[2].get<float>(), a[3].get<float>(),
                                           a[4].get<float>(), a[5].get<float>());
      }
      if (auto ch = n.find("ch"); ch != n.end() && ch->is_array()) {
        for (const auto& childJson : *ch) {
          DrawCmd child;
          if (compile(childJson, child)) {
            cmd.children.push_back(std::move(child));
          }
        }
      }
      return true;
    }

    if (auto pIt = n.find("p"); pIt != n.end() && pIt->is_object()) {
      const json& p = *pIt;
      PaintCmd& pc = cmd.paint;
      if (auto it = p.find("c"); it != p.end() && it->is_number()) {
        pc.color = it->get<uint32_t>();
      }
      pc.stroke = getInt(p, "st", 0) == 1;
      pc.strokeWidth = getAnimF(p, "sw", 1);
      pc.cap = getInt(p, "cap", 0);
      pc.join = getInt(p, "jn", 0);
      if (auto it = p.find("aa"); it != p.end() && it->is_boolean()) {
        pc.antiAlias = it->get<bool>();
      }
      pc.alpha = getAnimF(p, "a", 1);
      if (auto it = p.find("g"); it != p.end() && it->is_object()) {
        pc.shader = buildShader(*it);
      }
    }

    if (t == "r") {
      cmd.kind = DrawCmd::Rect;
    } else if (t == "rr") {
      cmd.kind = DrawCmd::RRect;
      cmd.rx = getAnimF(n, "rx", 0);
      cmd.ry = getAnimF(n, "ry", 0);
    } else if (t == "o") {
      cmd.kind = DrawCmd::Oval;
    } else if (t == "c") {
      cmd.kind = DrawCmd::Circle;
      cmd.cx = getAnimF(n, "cx", 0);
      cmd.cy = getAnimF(n, "cy", 0);
      cmd.r = getAnimF(n, "r", 0);
    } else if (t == "ln") {
      cmd.kind = DrawCmd::Line;
      cmd.x1 = getAnimF(n, "x1", 0);
      cmd.y1 = getAnimF(n, "y1", 0);
      cmd.x2 = getAnimF(n, "x2", 0);
      cmd.y2 = getAnimF(n, "y2", 0);
    } else if (t == "pa") {
      cmd.kind = DrawCmd::Path;
      std::string d;
      if (auto it = n.find("d"); it != n.end() && it->is_string()) {
        d = it->get<std::string>();
      }
      cmd.path = parseSvgPath(d);
    } else if (t == "im") {
      cmd.kind = DrawCmd::Image;
      std::string src;
      if (auto it = n.find("src"); it != n.end() && it->is_string()) {
        src = it->get<std::string>();
      }
      cmd.image = getImage(src);
      cmd.fit = getInt(n, "fit", 1);
    } else if (t == "tx") {
      cmd.kind = DrawCmd::Text;
      std::string family;
      if (auto it = n.find("s"); it != n.end() && it->is_string()) {
        cmd.text = it->get<std::string>();
      }
      if (auto it = n.find("ff"); it != n.end() && it->is_string()) {
        family = it->get<std::string>();
      }
      cmd.typeface = getTypeface(family);
      cmd.fontSize = getAnimF(n, "fs", 14);
    } else {
      return false;
    }

    if (cmd.kind != DrawCmd::Circle && cmd.kind != DrawCmd::Line) {
      cmd.x = getAnimF(n, "x", 0);
      cmd.y = getAnimF(n, "y", 0);
    }
    if (cmd.kind == DrawCmd::Rect || cmd.kind == DrawCmd::RRect ||
        cmd.kind == DrawCmd::Oval || cmd.kind == DrawCmd::Image) {
      cmd.w = getAnimF(n, "w", 0);
      cmd.h = getAnimF(n, "h", 0);
    }
    return true;
  };

  if (auto ch = rootIt->find("ch"); ch != rootIt->end() && ch->is_array()) {
    for (const auto& childJson : *ch) {
      DrawCmd cmd;
      if (compile(childJson, cmd)) {
        program->push_back(std::move(cmd));
      }
    }
  }

  std::lock_guard<std::mutex> lock(programMutex_);
  program_ = std::move(program);
}

void SceneRenderer::drawCmd(tgfx::Canvas* canvas, const DrawCmd& cmd,
                            const std::vector<double>& v,
                            tgfx::Paint& paint) const {
  if (cmd.kind == DrawCmd::Group) {
    canvas->save();
    if (cmd.hasMatrix) {
      canvas->concat(cmd.matrix);
    } else if (!cmd.ops.empty()) {
      canvas->concat(matrixFromOps(cmd.ops, v));
    }
    for (const auto& child : cmd.children) {
      drawCmd(canvas, child, v, paint);
    }
    canvas->restore();
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
                           const std::vector<double>& values) {
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
