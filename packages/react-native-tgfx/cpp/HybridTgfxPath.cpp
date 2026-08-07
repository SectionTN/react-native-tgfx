#include "HybridTgfxPath.hpp"

#include "PathOps.hpp"

namespace margelo::nitro::tgfx {

std::string HybridTgfxPath::op(const std::string& a, const std::string& b,
                               const std::string& op) {
  return tgfxrn::pathCombine(a, b, op);
}

PathBounds HybridTgfxPath::bounds(const std::string& path, bool tight) {
  auto rect = tgfxrn::pathBounds(path, tight);
  return PathBounds(rect.left, rect.top, rect.width(), rect.height());
}

bool HybridTgfxPath::contains(const std::string& path, double x, double y) {
  return tgfxrn::pathContains(path, static_cast<float>(x), static_cast<float>(y));
}

std::string HybridTgfxPath::transform(const std::string& path,
                                      const std::vector<double>& matrix) {
  return tgfxrn::pathTransform(path, matrix);
}

double HybridTgfxPath::length(const std::string& path) {
  return tgfxrn::pathLength(path);
}

PathPoint HybridTgfxPath::pointAtLength(const std::string& path, double distance) {
  auto point = tgfxrn::pathPointAtLength(path, static_cast<float>(distance));
  return PathPoint(point.x, point.y, point.angle);
}

std::string HybridTgfxPath::segment(const std::string& path, double start, double stop) {
  return tgfxrn::pathSegment(path, static_cast<float>(start), static_cast<float>(stop));
}

}  // namespace margelo::nitro::tgfx
