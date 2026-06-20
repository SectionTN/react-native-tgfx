#include "TgfxScene.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <functional>
#include <iterator>

#include <nlohmann/json.hpp>

#include "Base64.hpp"
#include "SvgPath.hpp"
#include "tgfx/core/Canvas.h"
#include "tgfx/core/Color.h"
#include "tgfx/core/Data.h"
#include "tgfx/core/Font.h"
#include "tgfx/core/Matrix.h"
#include "tgfx/core/Paint.h"
#include "tgfx/core/Path.h"
#include "tgfx/core/Point.h"
#include "tgfx/core/RRect.h"
#include "tgfx/core/Rect.h"
#include "tgfx/core/SamplingOptions.h"
#include "tgfx/core/Shader.h"
#include "tgfx/core/Stroke.h"

namespace tgfxrn {

using json = nlohmann::json;
using Values = std::vector<double>;

namespace {

// Resolve a JSON field that is either a literal number or an animated slot
// placeholder `{ "__s": index }` against the live values array.
double resolveSlot(const json& field, const Values& values, double def) {
  if (field.is_number()) {
    return field.get<double>();
  }
  if (field.is_object()) {
    auto it = field.find("__s");
    if (it != field.end() && it->is_number()) {
      size_t idx = it->get<size_t>();
      if (idx < values.size()) {
        return values[idx];
      }
    }
  }
  return def;
}

float getF(const json& j, const char* key, float def, const Values& values) {
  auto it = j.find(key);
  if (it != j.end()) {
    return static_cast<float>(resolveSlot(*it, values, def));
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

std::shared_ptr<tgfx::Shader> buildShader(const json& g, const Values& values) {
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
  int kind = static_cast<int>(getF(g, "k", 0, values));
  if (kind == 1) {
    return tgfx::Shader::MakeRadialGradient(
        tgfx::Point::Make(getF(g, "cx", 0, values), getF(g, "cy", 0, values)),
        getF(g, "r", 0, values), colors, positions);
  }
  return tgfx::Shader::MakeLinearGradient(
      tgfx::Point::Make(getF(g, "sx", 0, values), getF(g, "sy", 0, values)),
      tgfx::Point::Make(getF(g, "ex", 0, values), getF(g, "ey", 0, values)),
      colors, positions);
}

void buildPaint(const json& p, tgfx::Paint& paint, const Values& values) {
  uint32_t packed = 0xff000000u;
  if (auto it = p.find("c"); it != p.end() && it->is_number()) {
    packed = it->get<uint32_t>();
  }
  tgfx::Color color = colorFromPacked(packed);
  paint.setColor(color);

  if (auto it = p.find("g"); it != p.end() && it->is_object()) {
    auto shader = buildShader(*it, values);
    if (shader != nullptr) {
      paint.setShader(shader);
    }
  }

  int style = static_cast<int>(getF(p, "st", 0, values));
  if (style == 1) {
    paint.setStyle(tgfx::PaintStyle::Stroke);
    paint.setStrokeWidth(getF(p, "sw", 1.0f, values));
    switch (static_cast<int>(getF(p, "cap", 0, values))) {
      case 1: paint.setLineCap(tgfx::LineCap::Round); break;
      case 2: paint.setLineCap(tgfx::LineCap::Square); break;
      default: paint.setLineCap(tgfx::LineCap::Butt); break;
    }
    switch (static_cast<int>(getF(p, "jn", 0, values))) {
      case 1: paint.setLineJoin(tgfx::LineJoin::Round); break;
      case 2: paint.setLineJoin(tgfx::LineJoin::Bevel); break;
      default: paint.setLineJoin(tgfx::LineJoin::Miter); break;
    }
  } else {
    paint.setStyle(tgfx::PaintStyle::Fill);
  }

  bool aa = true;
  if (auto it = p.find("aa"); it != p.end() && it->is_boolean()) {
    aa = it->get<bool>();
  }
  paint.setAntiAlias(aa);

  float alphaMul = getF(p, "a", 1.0f, values);
  paint.setAlpha(color.alpha * alphaMul);
}

tgfx::Rect rectOf(const json& n, const Values& values) {
  return tgfx::Rect::MakeXYWH(getF(n, "x", 0, values), getF(n, "y", 0, values),
                              getF(n, "w", 0, values), getF(n, "h", 0, values));
}

// A 2x3 affine in tgfx setAll order: [scaleX, skewX, transX, skewY, scaleY, transY].
struct Affine {
  float a = 1, c = 0, e = 0, b = 0, d = 1, f = 0;
};

Affine multiply(const Affine& m1, const Affine& m2) {
  return Affine{
      m1.a * m2.a + m1.c * m2.b,
      m1.a * m2.c + m1.c * m2.d,
      m1.a * m2.e + m1.c * m2.f + m1.e,
      m1.b * m2.a + m1.d * m2.b,
      m1.b * m2.c + m1.d * m2.d,
      m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

// Build a matrix from a list of transform ops, resolving animated slots. Mirrors
// the JS affine composition so animated rotate/scale/translate match exactly.
tgfx::Matrix matrixFromOps(const json& ops, const Values& values) {
  Affine m;
  for (const auto& op : ops) {
    auto tIt = op.find("t");
    if (tIt == op.end() || !tIt->is_string()) {
      continue;
    }
    const std::string t = tIt->get<std::string>();
    Affine o;
    if (t == "translate") {
      o = Affine{1, 0, getF(op, "x", 0, values), 0, 1, getF(op, "y", 0, values)};
    } else if (t == "scale") {
      o = Affine{getF(op, "x", 1, values), 0, 0, 0, getF(op, "y", 1, values), 0};
    } else if (t == "rotate") {
      float r = getF(op, "r", 0, values);
      float cs = std::cos(r);
      float sn = std::sin(r);
      o = Affine{cs, -sn, 0, sn, cs, 0};
    } else if (t == "skewX") {
      o = Affine{1, std::tan(getF(op, "v", 0, values)), 0, 0, 1, 0};
    } else if (t == "skewY") {
      o = Affine{1, 0, 0, std::tan(getF(op, "v", 0, values)), 1, 0};
    }
    m = multiply(m, o);
  }
  return tgfx::Matrix::MakeAll(m.a, m.c, m.e, m.b, m.d, m.f);
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
  const char* fallbacks[] = {"", "sans-serif", "Helvetica", "Arial",
                             "Roboto"};
  if (!family.empty()) {
    typeface = tgfx::Typeface::MakeFromName(family, "");
  }
  for (size_t i = 0; typeface == nullptr && i < std::size(fallbacks); i++) {
    typeface = tgfx::Typeface::MakeFromName(fallbacks[i], "");
  }
  // On Android, MakeFromName can't resolve fonts by family — load the system
  // font files directly (CoreText already satisfied MakeFromName on iOS).
  const char* fontPaths[] = {
      "/system/fonts/Roboto-Regular.ttf",
      "/system/fonts/NotoSans-Regular.ttf",
      "/system/fonts/DroidSans.ttf",
  };
  for (size_t i = 0; typeface == nullptr && i < std::size(fontPaths); i++) {
    typeface = tgfx::Typeface::MakeFromPath(fontPaths[i]);
  }
  typefaceCache_[family] = typeface;
  return typeface;
}

void SceneRenderer::clearCaches() {
  imageCache_.clear();
  typefaceCache_.clear();
}

void SceneRenderer::render(tgfx::Canvas* canvas, const std::string& sceneJson,
                           const Values& values) {
  json root;
  try {
    root = json::parse(sceneJson);
  } catch (...) {
    return;
  }
  auto rootIt = root.find("root");
  if (rootIt == root.end()) {
    return;
  }

  std::function<void(const json&)> renderNode = [&](const json& n) {
    auto tIt = n.find("t");
    if (tIt == n.end() || !tIt->is_string()) {
      return;
    }
    const std::string t = tIt->get<std::string>();

    if (t == "g") {
      canvas->save();
      if (auto ops = n.find("ops"); ops != n.end() && ops->is_array()) {
        canvas->concat(matrixFromOps(*ops, values));
      } else if (auto m = n.find("m");
                 m != n.end() && m->is_array() && m->size() == 6) {
        const auto& a = *m;
        canvas->concat(tgfx::Matrix::MakeAll(
            a[0].get<float>(), a[1].get<float>(), a[2].get<float>(),
            a[3].get<float>(), a[4].get<float>(), a[5].get<float>()));
      }
      if (auto ch = n.find("ch"); ch != n.end() && ch->is_array()) {
        for (const auto& child : *ch) {
          renderNode(child);
        }
      }
      canvas->restore();
      return;
    }

    tgfx::Paint paint;
    auto pIt = n.find("p");
    if (pIt != n.end() && pIt->is_object()) {
      buildPaint(*pIt, paint, values);
    }

    if (t == "r") {
      canvas->drawRect(rectOf(n, values), paint);
    } else if (t == "rr") {
      canvas->drawRRect(tgfx::RRect::MakeRectXY(rectOf(n, values),
                                                getF(n, "rx", 0, values),
                                                getF(n, "ry", 0, values)),
                        paint);
    } else if (t == "o") {
      canvas->drawOval(rectOf(n, values), paint);
    } else if (t == "c") {
      canvas->drawCircle(getF(n, "cx", 0, values), getF(n, "cy", 0, values),
                         getF(n, "r", 0, values), paint);
    } else if (t == "ln") {
      if (paint.getStyle() != tgfx::PaintStyle::Stroke) {
        paint.setStyle(tgfx::PaintStyle::Stroke);
      }
      tgfx::Path path;
      path.moveTo(getF(n, "x1", 0, values), getF(n, "y1", 0, values));
      path.lineTo(getF(n, "x2", 0, values), getF(n, "y2", 0, values));
      canvas->drawPath(path, paint);
    } else if (t == "pa") {
      std::string d;
      if (auto it = n.find("d"); it != n.end() && it->is_string()) {
        d = it->get<std::string>();
      }
      canvas->drawPath(parseSvgPath(d), paint);
    } else if (t == "im") {
      std::string src;
      if (auto it = n.find("src"); it != n.end() && it->is_string()) {
        src = it->get<std::string>();
      }
      auto image = getImage(src);
      if (image != nullptr && image->width() > 0 && image->height() > 0) {
        float x = getF(n, "x", 0, values), y = getF(n, "y", 0, values);
        float w = getF(n, "w", 0, values), h = getF(n, "h", 0, values);
        int fit = static_cast<int>(getF(n, "fit", 1, values));
        tgfx::SamplingOptions sampling(tgfx::FilterMode::Linear);
        if (fit == 0) {
          canvas->drawImageRect(image, tgfx::Rect::MakeXYWH(x, y, w, h),
                                sampling, &paint);
        } else {
          float iw = static_cast<float>(image->width());
          float ih = static_cast<float>(image->height());
          float scale = (fit == 2) ? std::max(w / iw, h / ih)
                                   : std::min(w / iw, h / ih);
          float sw = iw * scale, sh = ih * scale;
          float dx = x + (w - sw) / 2, dy = y + (h - sh) / 2;
          bool clip = (fit == 2);
          if (clip) {
            canvas->save();
            canvas->clipRect(tgfx::Rect::MakeXYWH(x, y, w, h));
          }
          canvas->drawImageRect(image, tgfx::Rect::MakeXYWH(dx, dy, sw, sh),
                                sampling, &paint);
          if (clip) {
            canvas->restore();
          }
        }
      }
    } else if (t == "tx") {
      std::string s, family;
      if (auto it = n.find("s"); it != n.end() && it->is_string()) {
        s = it->get<std::string>();
      }
      if (auto it = n.find("ff"); it != n.end() && it->is_string()) {
        family = it->get<std::string>();
      }
      auto typeface = getTypeface(family);
      if (typeface != nullptr && !s.empty()) {
        tgfx::Font font(typeface, getF(n, "fs", 14.0f, values));
        canvas->drawSimpleText(s, getF(n, "x", 0, values),
                               getF(n, "y", 0, values), font, paint);
      }
    }
  };

  if (auto ch = rootIt->find("ch"); ch != rootIt->end() && ch->is_array()) {
    for (const auto& child : *ch) {
      renderNode(child);
    }
  }
}

}  // namespace tgfxrn
