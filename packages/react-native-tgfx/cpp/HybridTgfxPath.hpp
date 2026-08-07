#pragma once

#include <string>
#include <vector>

#include "HybridTgfxPathSpec.hpp"

namespace margelo::nitro::tgfx {

class HybridTgfxPath : public HybridTgfxPathSpec {
 public:
  HybridTgfxPath() : HybridObject(TAG) {}

  std::string op(const std::string& a, const std::string& b, const std::string& op) override;
  PathBounds bounds(const std::string& path, bool tight) override;
  bool contains(const std::string& path, double x, double y) override;
  std::string transform(const std::string& path, const std::vector<double>& matrix) override;
  double length(const std::string& path) override;
  PathPoint pointAtLength(const std::string& path, double distance) override;
  std::string segment(const std::string& path, double start, double stop) override;
};

}  // namespace margelo::nitro::tgfx
