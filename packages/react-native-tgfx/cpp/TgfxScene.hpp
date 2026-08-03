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
#include <vector>

#include "TextLayout.hpp"
#include "tgfx/core/BlendMode.h"
#include "tgfx/core/Matrix.h"
#include "tgfx/core/Paint.h"
#include "tgfx/core/Path.h"
#include "tgfx/core/Rect.h"
#include "tgfx/core/SamplingOptions.h"
#include "tgfx/core/TileMode.h"

namespace tgfx {
class Canvas;
class ColorFilter;
class Image;
class ImageFilter;
class Shader;
class Typeface;
}  // namespace tgfx

namespace tgfxrn {

/// Wire-format version, mirrored by SCENE_VERSION in src/compiler/writer.ts.
/// Lives here so the reader and the C++ test harness cannot drift apart.
inline constexpr double kSceneVersion = 11;

/// How an image is scaled into its destination rect. Mirrors Skia's `fit`,
/// which is Flutter's BoxFit; see fitRects() in TgfxScene.cpp.
enum class Fit { Fill = 0, Contain, Cover, FitWidth, FitHeight, None, ScaleDown };

/// Cursor over the binary draw program (defined in TgfxScene.cpp).
struct SceneReader;

/// How many colour/image filters have been constructed since process start.
/// Filters are built at setScene and only there, so this must not move while
/// frames are drawn — which is what cpp/tests/SceneTest.cpp asserts.
size_t filterBuildCount();

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
  std::string preamble;
  std::vector<std::string> functionNames;
  std::vector<tgfx::RuntimeShaderUniform> uniforms;
  /// One per float across `uniforms`, in order.
  std::vector<AnimF> slots;

  std::shared_ptr<tgfx::Shader> build(std::span<const double> values) const;
};

/// An <ImageShader> whose handle is a hardware-buffer import. The image behind
/// such a handle changes between frames with no re-commit, so the shader has to
/// be rebuilt per frame from the handle rather than baked at setScene.
struct ImageShaderCmd {
  int32_t handle = 0;
  tgfx::TileMode tileX = tgfx::TileMode::Clamp;
  tgfx::TileMode tileY = tgfx::TileMode::Clamp;
  tgfx::SamplingOptions sampling{tgfx::FilterMode::Linear, tgfx::MipmapMode::None};
  bool hasRect = false;
  tgfx::Rect rect = tgfx::Rect::MakeEmpty();
  Fit fit = Fit::Contain;

  std::shared_ptr<tgfx::Shader> build(const std::shared_ptr<tgfx::Image>& image) const;
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
  /// Set only for an <ImageShader> on a hardware-buffer handle, which resolves
  /// per frame; otherwise the shader above stands.
  std::shared_ptr<ImageShaderCmd> imageShader;
  /// Filters and blend mode, all built once by setScene: their inputs are
  /// literals, so nothing here is ever rebuilt on the render thread.
  tgfx::BlendMode blend = tgfx::BlendMode::SrcOver;
  std::shared_ptr<tgfx::ColorFilter> colorFilter;
  std::shared_ptr<tgfx::ImageFilter> imageFilter;
  /// Set when a blend mode meets an image filter, which tgfx cannot honour on
  /// one paint: its implicit layer carries only the filter and comes back
  /// SrcOver. This paint takes that layer instead, carrying both, and `blend`
  /// and `imageFilter` above are cleared so the draw inside it is plain.
  std::shared_ptr<tgfx::Paint> layer;
  /// The whole paint resolved against its literals, built once by setScene.
  tgfx::Paint cached;

  /// True when a per-frame value feeds the paint, so `cached` is not the paint.
  /// strokeWidth only reaches the paint on a stroke, so a fill keeps its cache.
  bool animated() const {
    return alpha.slot >= 0 || runtime != nullptr || imageShader != nullptr ||
           (stroke && strokeWidth.slot >= 0);
  }
};

/// type: 0 translate(a=x,b=y), 1 scale(a=x,b=y), 2 rotate(a), 3 skewX(a), 4 skewY(a)
struct TransformOpCmd {
  int type = 0;
  AnimF a;
  AnimF b;
};

/// A <Text> or <TextPath>: everything the layout needs, plus the laid-out blob
/// for the size it was last drawn at.
///
/// Held behind a shared_ptr so DrawCmd — which readNode recurses on, on the
/// render thread's stack — does not carry a paragraph's worth of fields for
/// every rect in the scene.
struct TextCmd {
  std::string text;
  TextSpec spec;
  /// <TextPath> only; `onPath` is what tells the two apart.
  tgfx::Path path;
  bool onPath = false;

  /// The layout for the size last drawn, rebuilt only when that size changes.
  /// Mutable because the program is shared as const, and touched only by the
  /// render thread, which is the one thread that both compiles and draws.
  const TextLayout& resolve(float size) const;

 private:
  mutable float layoutSize = -1;
  mutable TextLayout layout;
};

struct DrawCmd {
  enum Kind { Group, Rect, RRect, Oval, Circle, Line, Path, Image, Text, Fill };
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
  // Image (resolved from its handle once, mipmapped once). A hardware-buffer
  // handle leaves this null and carries `imageHandle` instead: caching the
  // resolved image would pin the producer's buffer between frames and would
  // never see the next one.
  std::shared_ptr<tgfx::Image> image;
  int32_t imageHandle = 0;
  Fit fit = Fit::Contain;
  tgfx::SamplingOptions sampling{tgfx::FilterMode::Linear, tgfx::MipmapMode::None};
  /// Source sub-rect, for sprite sheets; empty means the whole image.
  tgfx::Rect srcRect = tgfx::Rect::MakeEmpty();
  // Text and TextPath; null for every other kind.
  std::shared_ptr<TextCmd> text;
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

  /// Drop the program. Images and typefaces belong to the process-wide
  /// ImageRegistry and FontRegistry, which are keyed on JS handle and font
  /// lifetime, not on the view.
  void clearCaches();

 private:
  std::shared_ptr<const Program> program_;
  std::mutex programMutex_;

  bool readNode(SceneReader& reader, DrawCmd& cmd, int depth);
  /// Reads the family/weight/style/spacing block both text kinds share.
  void readTextSpec(SceneReader& reader, TextSpec& spec);
  void readPaint(SceneReader& reader, PaintCmd& paint);
  /// Builds the paint's blend mode and filters, once.
  void readFilters(SceneReader& reader, PaintCmd& paint);
  /// Builds the paint's shader, or parks a per-frame one on `out`.
  std::shared_ptr<tgfx::Shader> readShader(SceneReader& reader, PaintCmd* out);

  void drawCmd(tgfx::Canvas* canvas, const DrawCmd& cmd, std::span<const double> values,
               tgfx::Paint& paint) const;
};

}  // namespace tgfxrn
