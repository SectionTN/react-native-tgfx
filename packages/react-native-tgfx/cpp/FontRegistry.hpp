// The typeface table behind <Text> and <TextPath>.
//
// Two jobs. First, it holds the faces JS registered from app assets, keyed by
// family, so `fontFamily` + `fontWeight` + `fontStyle` picks a real face out of
// a family instead of whatever the OS happened to hand back.
//
// Second, it resolves a family the app did not register. tgfx's
// Typeface::MakeFromName is CoreGraphics-backed on Apple and returns nullptr on
// every FreeType platform (SystemFont.cpp is Windows/DirectWrite only), so on
// Android the only resolution that can work is opening a font file. This scans
// the platform font directories and matches on what is actually installed
// rather than naming three files that no OEM guarantees.
//
// Process-wide, like ImageRegistry: a face registered once is visible to every
// canvas, and a scene compiled on one view's render thread must see it.
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

/// CSS font weights, as tgfx's FontWeight enum spells them.
inline constexpr int kWeightNormal = 400;
inline constexpr int kWeightBold = 700;

/// A resolved face plus the synthesis needed to reach the asked-for style, so a
/// family that ships only a regular face can still be drawn bold or italic.
struct FontMatch {
  std::shared_ptr<tgfx::Typeface> typeface;
  bool fauxBold = false;
  bool fauxItalic = false;
};

/// What a font file claims about itself, read from its OS/2 (or head) table.
struct FaceStyle {
  int weight = kWeightNormal;
  bool italic = false;
};

/// Reads usWeightClass and fsSelection out of the typeface's OS/2 table, falling
/// back to head.macStyle. This is the font's own answer, so a face registered
/// under an explicit family still lands at the right weight without the caller
/// having to describe it.
FaceStyle readFaceStyle(const std::shared_ptr<tgfx::Typeface>& typeface);

/// Indices into `files`, best filename match for family+weight+italic first.
/// Empty when nothing plausible is there.
///
/// A ranking rather than a single answer because a filename cannot tell you
/// what a font covers: on a real Samsung image the best-scoring bold face is
/// NotoSansCham-Bold, which has no Latin at all. The caller walks the list until
/// one actually opens and can draw.
///
/// Filenames only: opening 275 system fonts to read their name tables would cost
/// more than the draw it serves. Split out and pure so the acceptance case — a
/// device whose image has none of the three names the old code hardcoded — is a
/// host test rather than a device you have to go find.
std::vector<int> rankFontFiles(const std::vector<std::string>& files, const std::string& family,
                               int weight, bool italic);

class FontRegistry {
 public:
  static FontRegistry& instance();

  /// Register `typeface` under `family`, or under its own family name when
  /// `family` is empty. Returns the name it was filed under, empty on failure.
  std::string add(std::shared_ptr<tgfx::Typeface> typeface, const std::string& family);

  /// The best face for family + weight + italic. Falls back to the platform's
  /// default family when the family is unknown, so text always draws something.
  FontMatch match(const std::string& family, int weight, bool italic);

  /// Faces to try, in order, for a codepoint the matched face has no glyph for.
  /// Today that is the platform's color-emoji font; anything else needs script
  /// fallback, which needs shaping.
  std::vector<std::shared_ptr<tgfx::Typeface>> fallbacks();

  /// Every registered family name, for the JS-side font list.
  std::vector<std::string> familyNames() const;

  /// Bumped by every successful add(). Mixed into the scene hash, so a scene
  /// committed before a font finished loading recompiles against it instead of
  /// being skipped as unchanged.
  uint64_t epoch() const {
    return epoch_.load(std::memory_order_acquire);
  }

  /// Drop every registered face and every cached match. Tests only.
  void clear();

 private:
  FontRegistry() = default;

  struct Face {
    std::shared_ptr<tgfx::Typeface> typeface;
    FaceStyle style;
  };

  /// Holds `mutex_`.
  FontMatch resolveLocked(const std::string& family, int weight, bool italic);
  std::shared_ptr<tgfx::Typeface> systemTypefaceLocked(const std::string& family, int weight,
                                                       bool italic);

  mutable std::mutex mutex_;
  /// Keyed on the folded family name; a family holds every face registered for it.
  std::unordered_map<std::string, std::vector<Face>> families_;
  /// Registration order, for familyNames().
  std::vector<std::string> familyOrder_;
  /// Resolved matches, keyed "family|weight|italic". Bounded by clearing: the
  /// key space is (families the app asks for) x (styles), which is small, and a
  /// process that somehow blows past the cap re-resolves rather than growing.
  std::unordered_map<std::string, FontMatch> matches_;
  /// Faces opened from a font file, keyed by path, so two families resolving to
  /// the same file share one typeface.
  std::unordered_map<std::string, std::shared_ptr<tgfx::Typeface>> files_;
  std::vector<std::shared_ptr<tgfx::Typeface>> fallbacks_;
  bool fallbacksResolved_ = false;
  std::atomic<uint64_t> epoch_{0};
};

}  // namespace tgfxrn
