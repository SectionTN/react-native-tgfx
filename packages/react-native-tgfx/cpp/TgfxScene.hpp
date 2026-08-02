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
#include <optional>
#include <span>
#include <string>
#include <unordered_map>
#include <vector>

#include "tgfx/core/Font.h"
#include "tgfx/core/Matrix.h"
#include "tgfx/core/Paint.h"
#include "tgfx/core/Path.h"

namespace tgfx {
class Canvas;
class Image;
class Shader;
class Typeface;
}  // namespace tgfx

namespace tgfxrn {

/// Wire-format version, mirrored by SCENE_VERSION in src/compiler/writer.ts.
/// Lives here so the reader and the C++ test harness cannot drift apart.
inline constexpr double kSceneVersion = 6;

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

/// A runtime shader with at least one uniform on an animation slot, so the
/// shader has to be rebuilt per frame. Cheap: tgfx keys the compiled program on
/// the source and the uniform names/sizes, never on the values.
struct RuntimeShaderCmd {
  std::string body;
  std::vector<tgfx::RuntimeShaderUniform> uniforms;
  /// One per float across `uniforms`, in order.
  std::vector<AnimF> slots;

  std::shared_ptr<tgfx::Shader> build(std::span<const double> values) const;
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
  /// Set only when a uniform is animated; otherwise the shader above stands.
  std::shared_ptr<RuntimeShaderCmd> runtime;
  /// The whole paint resolved against its literals, built once by setScene.
  tgfx::Paint cached;

  /// True when a per-frame value feeds the paint, so `cached` is not the paint.
  /// strokeWidth only reaches the paint on a stroke, so a fill keeps its cache.
  bool animated() const {
    return alpha.slot >= 0 || runtime != nullptr ||
           (stroke && strokeWidth.slot >= 0);
  }
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

  // Path (parsed once); a static Line keeps its two-point path here too.
  tgfx::Path path;
  bool lineAnimated = false;
  // Image (created once)
  std::shared_ptr<tgfx::Image> image;
  int fit = 1;
  // Text (font built once; absent when no typeface resolved)
  std::string text;
  std::optional<tgfx::Font> font;
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

  /// Drop the program and the cached images/typefaces.
  void clearCaches();

 private:
  std::shared_ptr<const Program> program_;
  std::mutex programMutex_;

  // Compile-time resource caches (accessed only on the scene-change thread).
  std::unordered_map<size_t, std::shared_ptr<tgfx::Image>> imageCache_;
  std::unordered_map<std::string, std::shared_ptr<tgfx::Typeface>> typefaceCache_;

  std::shared_ptr<tgfx::Image> getImage(const std::string& base64);
  std::shared_ptr<tgfx::Typeface> getTypeface(const std::string& family);

  bool readNode(SceneReader& reader, DrawCmd& cmd, int depth);
  void readPaint(SceneReader& reader, PaintCmd& paint);
  std::shared_ptr<tgfx::Shader> readShader(
      SceneReader& reader, std::shared_ptr<RuntimeShaderCmd>* runtimeOut);

  void drawCmd(tgfx::Canvas* canvas, const DrawCmd& cmd, std::span<const double> values,
               tgfx::Paint& paint) const;
};

}  // namespace tgfxrn
