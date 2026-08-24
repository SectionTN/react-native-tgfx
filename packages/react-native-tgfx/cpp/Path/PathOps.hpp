// Path geometry behind the TgfxPath hybrid, kept free of Nitro so host tests can link it.
#pragma once

#include <string>
#include <vector>

#include "tgfx/core/Path.h"
#include "tgfx/core/Rect.h"

namespace tgfxrn {

struct PathPointResult {
  float x = 0;
  float y = 0;
  /// Radians, as std::atan2 measures: 0 points along +x.
  float angle = 0;
  bool ok = false;
};

/// "union" / "difference" / "intersect" / "xor"; anything else appends, as tgfx defaults.
std::string pathCombine(const std::string& a, const std::string& b, const std::string& op);

tgfx::Rect pathBounds(const std::string& path, bool tight);

bool pathContains(const std::string& path, float x, float y);

/// `matrix` is [a, b, c, d, tx, ty]; fewer than six entries leaves the path alone.
std::string pathTransform(const std::string& path, const std::vector<double>& matrix);

float pathLength(const std::string& path);

PathPointResult pathPointAtLength(const std::string& path, float distance);

/// Empty when start >= stop or the path has no length — the cases tgfx refuses.
std::string pathSegment(const std::string& path, float start, float stop);

}  // namespace tgfxrn
