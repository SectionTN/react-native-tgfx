// SceneRenderer compiles the binary draw-program produced by the JS reconciler
// into a native command list ONCE per scene change (setScene), resolving images,
// paths, typefaces and static shaders up front. Each frame, render() executes
// that immutable command list, resolving only the animated value slots — no
// per-frame parsing, base64 decoding, SVG path parsing, or font lookups.
//
// The compiled program is swapped under a mutex and read as an immutable
// shared_ptr, so the render thread never sees a half-built program.
#pragma once

#include <cstdint>
#include <memory>
#include <mutex>
#include <span>
#include <string>
#include <unordered_map>
#include <vector>

#include "tgfx/core/Matrix.h"
#include "tgfx/core/Path.h"

namespace tgfx {
class Canvas;
class Image;
class Shader;
class Typeface;
class Paint;
}  // namespace tgfx

namespace tgfxrn {

/// Cursor over the binary draw program (defined in TgfxScene.cpp).
struct SceneReader;

/// A float that is either a literal or an animated slot (slot < 0 => literal).
struct AnimF {
  float literal = 0;
  int slot = -1;

  float resolve(std::span<const double> values) const {
    if (slot >= 0 && static_cast<size_t>(slot) < values.size()) {
      return static_cast<float>(values[static_cast<size_t>(slot)]);
    }
    return literal;
  }
};

struct PaintCmd {
  uint32_t color = 0xff000000;
  bool stroke = false;
  AnimF strokeWidth{1, -1};
  int cap = 0;
  int join = 0;
  bool antiAlias = true;
  AnimF alpha{1, -1};
  std::shared_ptr<tgfx::Shader> shader;  // built once for static gradients
};

/// type: 0 translate(a=x,b=y), 1 scale(a=x,b=y), 2 rotate(a), 3 skewX(a), 4 skewY(a)
struct TransformOpCmd {
  int type = 0;
  AnimF a;
  AnimF b;
};

struct DrawCmd {
  enum Kind { Group, Rect, RRect, Oval, Circle, Line, Path, Image, Text };
  Kind kind = Group;

  AnimF x, y, w, h, rx, ry, cx, cy, r, x1, y1, x2, y2, fontSize;
  PaintCmd paint;

  // Group
  bool hasMatrix = false;
  tgfx::Matrix matrix = tgfx::Matrix::I();
  std::vector<TransformOpCmd> ops;
  std::vector<DrawCmd> children;

  // Path (parsed once)
  tgfx::Path path;
  // Image (created once)
  std::shared_ptr<tgfx::Image> image;
  int fit = 1;
  // Text
  std::string text;
  std::shared_ptr<tgfx::Typeface> typeface;
};

using Program = std::vector<DrawCmd>;

class SceneRenderer {
 public:
  /// Compile the binary program (see src/compiler/writer.ts) into the command
  /// list, resolving `strings` indices to paths, text, images and shader source.
  void setScene(std::span<const double> words,
                const std::vector<std::string>& strings);

  /// Execute the compiled program, resolving slot placeholders against `values`.
  void render(tgfx::Canvas* canvas, std::span<const double> values);

  /// Drop the program and cached GPU/CPU resources.
  void clearCaches();

 private:
  std::shared_ptr<const Program> program_;
  std::mutex programMutex_;

  // Compile-time resource caches (accessed only on the scene-change thread).
  std::unordered_map<size_t, std::shared_ptr<tgfx::Image>> imageCache_;
  std::unordered_map<std::string, std::shared_ptr<tgfx::Typeface>> typefaceCache_;

  std::shared_ptr<tgfx::Image> getImage(const std::string& base64);
  std::shared_ptr<tgfx::Typeface> getTypeface(const std::string& family);

  bool readNode(SceneReader& reader, DrawCmd& cmd);
  void readPaint(SceneReader& reader, PaintCmd& paint);
  std::shared_ptr<tgfx::Shader> readShader(SceneReader& reader);

  void drawCmd(tgfx::Canvas* canvas, const DrawCmd& cmd, std::span<const double> values,
               tgfx::Paint& paint) const;
};

}  // namespace tgfxrn
