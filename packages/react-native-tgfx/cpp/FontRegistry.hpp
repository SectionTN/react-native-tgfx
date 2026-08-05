// The typeface table behind <Text>: JS-registered faces, plus a scan for unregistered families.
#pragma once

#include <atomic>
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

namespace tgfx {
class Typeface;
}

namespace tgfxrn {

inline constexpr int kWeightNormal = 400;
inline constexpr int kWeightBold = 700;

struct FontMatch {
  std::shared_ptr<tgfx::Typeface> typeface;
  bool fauxBold = false;
  bool fauxItalic = false;
};

struct FaceStyle {
  int weight = kWeightNormal;
  bool italic = false;
};

/// Reads the font's own OS/2 (or head.macStyle) weight and slant, so the caller need not say.
FaceStyle readFaceStyle(const std::shared_ptr<tgfx::Typeface>& typeface);

/// Indices into `files`, best filename match first. A name says nothing about coverage.
std::vector<int> rankFontFiles(const std::vector<std::string>& files, const std::string& family,
                               int weight, bool italic);

class FontRegistry {
 public:
  static FontRegistry& instance();

  std::string add(std::shared_ptr<tgfx::Typeface> typeface, const std::string& family);

  FontMatch match(const std::string& family, int weight, bool italic);

  std::vector<std::shared_ptr<tgfx::Typeface>> fallbacks();

  std::vector<std::string> familyNames() const;

  /// Bumped by every add() and mixed into the scene hash, so a late font forces a recompile.
  uint64_t epoch() const {
    return epoch_.load(std::memory_order_acquire);
  }

  void clear();

 private:
  FontRegistry() = default;

  struct Face {
    std::shared_ptr<tgfx::Typeface> typeface;
    FaceStyle style;
  };

  FontMatch resolveLocked(const std::string& family, int weight, bool italic);
  std::shared_ptr<tgfx::Typeface> systemTypefaceLocked(const std::string& family, int weight,
                                                       bool italic);

  mutable std::mutex mutex_;
  std::unordered_map<std::string, std::vector<Face>> families_;
  std::vector<std::string> familyOrder_;
  std::unordered_map<std::string, FontMatch> matches_;
  std::unordered_map<std::string, std::shared_ptr<tgfx::Typeface>> files_;
  std::vector<std::shared_ptr<tgfx::Typeface>> fallbacks_;
  bool fallbacksResolved_ = false;
  std::atomic<uint64_t> epoch_{0};
};

}  // namespace tgfxrn
