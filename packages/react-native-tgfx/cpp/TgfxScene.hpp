// SceneRenderer compiles the draw program once per change; render() resolves only the value slots.
#pragma once

#include <array>
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
inline constexpr double kSceneVersion = 18;

/// How an image is scaled into its destination rect; see fitRects() in TgfxScene.cpp.
enum class Fit { Fill = 0, Contain, Cover, FitWidth, FitHeight, None, ScaleDown };

struct SceneReader;

/// Filters built since process start. Built at setScene only, which SceneTest.cpp asserts.
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

/// One `uniform shader` slot; `image` is set instead when the child resolves per frame.
struct RuntimeShaderCmd;

struct ChildShaderCmd {
  std::shared_ptr<tgfx::Shader> shader;
  std::shared_ptr<ImageShaderCmd> image;
  std::shared_ptr<RuntimeShaderCmd> runtime;

  bool dynamic() const {
    return image != nullptr || runtime != nullptr;
  }

  std::shared_ptr<tgfx::Shader> resolve(std::span<const double> values) const;
};

struct RuntimeShaderCmd {
  std::string body;
  std::string preamble;
  std::vector<std::string> functionNames;
  std::vector<tgfx::RuntimeShaderUniform> uniforms;
  std::vector<AnimF> slots;
  std::vector<ChildShaderCmd> children;

  std::shared_ptr<tgfx::Shader> build(std::span<const double> values) const;
};

struct PaintCmd {
  uint32_t color = 0xff000000;
  /// Set when the colour is animated; `color` above holds the last committed value.
  std::array<AnimF, 4> rgba{};
  bool animColor = false;
  bool stroke = false;
  AnimF strokeWidth{1, -1};
  int cap = 0;
  int join = 0;
  float miter = 4;
  bool antiAlias = true;
  AnimF alpha{1, -1};
  std::shared_ptr<tgfx::Shader> shader;  // built once for static gradients
  std::shared_ptr<RuntimeShaderCmd> runtime;
  /// Set only for an <ImageShader> on a hardware-buffer handle; otherwise the shader stands.
  std::shared_ptr<ImageShaderCmd> imageShader;
  /// Filters and blend mode, built once by setScene: their inputs are literals.
  tgfx::BlendMode blend = tgfx::BlendMode::SrcOver;
  std::shared_ptr<tgfx::ColorFilter> colorFilter;
  std::shared_ptr<tgfx::ImageFilter> imageFilter;
  /// Set when a blend mode meets an image filter, which tgfx cannot honour on one paint.
  std::shared_ptr<tgfx::Paint> layer;
  tgfx::Paint cached;

  bool animated() const {
    return animColor || alpha.slot >= 0 || runtime != nullptr ||
           imageShader != nullptr || (stroke && strokeWidth.slot >= 0);
  }
};

/// type: 0 translate(a=x,b=y), 1 scale(a=x,b=y), 2 rotate(a), 3 skewX(a), 4 skewY(a)
struct TransformOpCmd {
  int type = 0;
  AnimF a;
  AnimF b;
};

/// A ceiling on <Span> children, so a corrupt run count cannot loop without bound.
inline constexpr int kMaxTextRuns = 4096;

/// The same ceiling for <Glyphs>, whose count comes straight off the wire.
inline constexpr int kMaxGlyphs = 65536;

/// A <Text> or <TextPath>. Behind a shared_ptr so DrawCmd, which readNode recurses on, stays small.
struct TextCmd {
  std::vector<TextRun> runs;
  TextSpec spec;
  tgfx::Path path;
  bool onPath = false;
  std::vector<PlacedGlyph> glyphs;

  /// The layout for the size last drawn. Mutable because only the render thread touches it.
  const TextLayout& resolve(float size) const;

 private:
  mutable float layoutSize = -1;
  mutable TextLayout layout;
};

struct DrawCmd {
  enum Kind {
    Group, Rect, RRect, Oval, Circle, Line, Path, Image, Text, Fill, CameraFrame
  };

  /// Group extras: 0 no clip, 1 rect, 2 round rect, 3 path.
  int clipKind = 0;
  bool invertClip = false;
  bool layer = false;
  AnimF layerAlpha{1, -1};
  tgfx::Rect clipRect = tgfx::Rect::MakeEmpty();
  float clipRadiusX = 0;
  float clipRadiusY = 0;
  tgfx::Path clipPath;
  Kind kind = Group;

  AnimF x, y, w, h, rx, ry, cx, cy, r, x1, y1, x2, y2, fontSize;
  PaintCmd paint;

  bool hasMatrix = false;
  tgfx::Matrix matrix = tgfx::Matrix::I();
  std::vector<TransformOpCmd> ops;
  std::vector<DrawCmd> children;

  tgfx::Path path;
  bool lineAnimated = false;
  // Null for a hardware-buffer handle: caching the resolved image would pin the producer's buffer.
  std::shared_ptr<tgfx::Image> image;
  int32_t imageHandle = 0;
  Fit fit = Fit::Contain;
  tgfx::SamplingOptions sampling{tgfx::FilterMode::Linear, tgfx::MipmapMode::None};
  tgfx::Rect srcRect = tgfx::Rect::MakeEmpty();
  // CameraFrame: quarter turns clockwise, 0-3, applied before the fit.
  int quarterTurns = 0;
  bool mirror = false;
  std::shared_ptr<TextCmd> text;
};

using Program = std::vector<DrawCmd>;

class SceneRenderer {
 public:
  void setScene(std::span<const double> words,
                const std::vector<std::string>& strings);

  void render(tgfx::Canvas* canvas, std::span<const double> values);

  void clearCaches();

 private:
  std::shared_ptr<const Program> program_;
  std::mutex programMutex_;

  bool readNode(SceneReader& reader, DrawCmd& cmd, int depth);
  void readTextSpec(SceneReader& reader, TextSpec& spec);
  void readTextRuns(SceneReader& reader, TextCmd& text);
  void readPaint(SceneReader& reader, PaintCmd& paint);
  void readFilters(SceneReader& reader, PaintCmd& paint);
  std::shared_ptr<tgfx::Shader> readShader(SceneReader& reader, PaintCmd* out,
                                           int depth = 0);

  void drawCmd(tgfx::Canvas* canvas, const DrawCmd& cmd, std::span<const double> values,
               tgfx::Paint& paint) const;
};

}  // namespace tgfxrn
