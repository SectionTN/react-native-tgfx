#include "FontRegistry.hpp"

#include <algorithm>
#include <array>
#include <cctype>
#include <cstdlib>
#include <cstring>

#include <dirent.h>

#include "ImageRegistry.hpp"
#include "Log.hpp"
#include "tgfx/core/Data.h"
#include "tgfx/core/FontStyle.h"
#include "tgfx/core/Typeface.h"

namespace tgfxrn {
namespace {

/// Lowercased, with everything that is not a letter or digit dropped, so
/// "Playfair Display", "playfair-display" and "PlayfairDisplay" are one key.
std::string fold(const std::string& name) {
  std::string out;
  out.reserve(name.size());
  for (unsigned char c : name) {
    if (std::isalnum(c) != 0) {
      out.push_back(static_cast<char>(std::tolower(c)));
    }
  }
  return out;
}

/// The file's stem, folded — "NotoSans-Bold.ttf" becomes "notosansbold".
std::string foldedStem(const std::string& path) {
  auto slash = path.find_last_of('/');
  auto name = slash == std::string::npos ? path : path.substr(slash + 1);
  auto dot = name.find_last_of('.');
  return fold(dot == std::string::npos ? name : name.substr(0, dot));
}

bool contains(const std::string& haystack, const char* needle) {
  return haystack.find(needle) != std::string::npos;
}

constexpr uint32_t tableTag(const char (&tag)[5]) {
  return (static_cast<uint32_t>(tag[0]) << 24) | (static_cast<uint32_t>(tag[1]) << 16) |
         (static_cast<uint32_t>(tag[2]) << 8) | static_cast<uint32_t>(tag[3]);
}

uint16_t beU16(const uint8_t* bytes) {
  return static_cast<uint16_t>((bytes[0] << 8) | bytes[1]);
}

/// Where a font file can live. The first three are Android (the last two carry
/// the OEM's own faces on treble images); the rest keep the desktop host tests
/// honest. Nothing here is a *file* name — that is the whole point.
constexpr std::array<const char*, 6> kFontDirs = {
    "/system/fonts",   "/product/fonts", "/system/font",
    "/data/fonts",     "/System/Library/Fonts", "/Library/Fonts",
};

bool isFontFile(const std::string& name) {
  auto dot = name.find_last_of('.');
  if (dot == std::string::npos) {
    return false;
  }
  std::string ext = fold(name.substr(dot));
  return ext == "ttf" || ext == "otf" || ext == "ttc" || ext == "otc";
}

/// Walked once per process and kept: readdir on a handful of directories is
/// cheap, but not per <Text>, and both resolution and the fallback chain want
/// the same list.
const std::vector<std::string>& systemFontFiles();

std::vector<std::string> scanFontDirs() {
  std::vector<std::string> files;
  for (const char* dir : kFontDirs) {
    DIR* handle = opendir(dir);
    if (handle == nullptr) {
      continue;
    }
    while (auto* entry = readdir(handle)) {
      std::string name = entry->d_name;
      if (isFontFile(name)) {
        files.push_back(std::string(dir) + "/" + name);
      }
    }
    closedir(handle);
  }
  // A stable order, so the same image always resolves to the same face.
  std::sort(files.begin(), files.end());
  return files;
}

const std::vector<std::string>& systemFontFiles() {
  static const std::vector<std::string> files = scanFontDirs();
  return files;
}

/// Families to try, in order, when the app asked for none or for one that is
/// not installed. Substrings of a *folded stem*, not paths: any image with a
/// Roboto, a Noto Sans, a Droid Sans or a DejaVu matches whatever it calls the
/// file.
constexpr std::array<const char*, 5> kDefaultFamilies = {"roboto", "notosans", "droidsans",
                                                         "dejavusans", "sans"};

/// Fonts that must never answer a plain text request: picking one for "the
/// default family" is how you end up rendering a paragraph in emoji or in a
/// symbol font that has no Latin at all.
bool isSpecialPurpose(const std::string& stem) {
  return contains(stem, "emoji") || contains(stem, "symbol") || contains(stem, "icon") ||
         contains(stem, "material") || contains(stem, "dingbat") || contains(stem, "awesome");
}

/// "Resolved" has to mean "can draw text". CoreText answers a descriptor that
/// names no family with *a* font, and the one it picks is a symbol face with no
/// Latin at all — so a candidate that cannot map 'A' and '0' is not a fallback,
/// it is a blank label.
bool canDrawText(const std::shared_ptr<tgfx::Typeface>& typeface) {
  return typeface != nullptr && typeface->getGlyphID('A') != 0 &&
         typeface->getGlyphID('0') != 0;
}

/// Asked for by name, never as an empty descriptor. iOS and macOS answer the
/// first of these; every FreeType platform answers none of them and falls
/// through to the directory scan.
constexpr std::array<const char*, 4> kSystemDefaults = {"Helvetica", "Arial", "sans-serif",
                                                        "Roboto"};

}  // namespace

FaceStyle readFaceStyle(const std::shared_ptr<tgfx::Typeface>& typeface) {
  FaceStyle style;
  if (typeface == nullptr) {
    return style;
  }
  // OS/2: usWeightClass at byte 4, fsSelection at byte 62 (bit 0 italic,
  // bit 5 bold, bit 9 oblique). Both uint16 big-endian.
  auto os2 = typeface->copyTableData(tableTag("OS/2"));
  if (os2 != nullptr && os2->size() >= 64) {
    const auto* bytes = static_cast<const uint8_t*>(os2->data());
    auto weight = beU16(bytes + 4);
    // Some old fonts store 1-9 instead of 100-900.
    if (weight > 0 && weight <= 9) {
      weight = static_cast<uint16_t>(weight * 100);
    }
    if (weight >= 100 && weight <= 1000) {
      style.weight = weight;
    }
    auto selection = beU16(bytes + 62);
    style.italic = (selection & 0x01) != 0 || (selection & 0x200) != 0;
    if ((selection & 0x20) != 0 && style.weight < kWeightBold) {
      style.weight = kWeightBold;
    }
    return style;
  }
  // head.macStyle at byte 44: bit 0 bold, bit 1 italic.
  auto head = typeface->copyTableData(tableTag("head"));
  if (head != nullptr && head->size() >= 46) {
    auto macStyle = beU16(static_cast<const uint8_t*>(head->data()) + 44);
    style.italic = (macStyle & 0x02) != 0;
    if ((macStyle & 0x01) != 0) {
      style.weight = kWeightBold;
    }
  }
  return style;
}

std::vector<int> rankFontFiles(const std::vector<std::string>& files, const std::string& family,
                               int weight, bool italic) {
  auto wanted = fold(family);
  bool wantBold = weight >= 600;
  // A special-purpose face only answers a request that asked for one by name:
  // "Noto" prefix-matches NotoColorEmoji, which would otherwise outrank every
  // real text face on the image and draw the whole paragraph as .notdef.
  bool wantsSpecial = !wanted.empty() && isSpecialPurpose(wanted);
  std::vector<std::pair<int, int>> scored;  // (score, index)
  for (size_t i = 0; i < files.size(); i++) {
    auto stem = foldedStem(files[i]);
    if (isSpecialPurpose(stem) && !wantsSpecial) {
      continue;
    }
    int score = 0;
    if (!wanted.empty()) {
      if (stem.rfind(wanted, 0) == 0) {
        // A stem that starts with the family: "playfairdisplaybold" for
        // "Playfair Display". Worth more than any style bonus below, so a weight
        // mismatch inside the right family always beats the wrong family.
        score = 1000;
      } else if (contains(stem, wanted.c_str())) {
        score = 500;
      }
    }
    if (score == 0) {
      // No family, or one this image does not have: whatever text font it does.
      for (size_t d = 0; d < kDefaultFamilies.size(); d++) {
        if (contains(stem, kDefaultFamilies[d])) {
          score = static_cast<int>(kDefaultFamilies.size() - d) * 10;
          break;
        }
      }
      // Still nothing: any text font beats drawing nothing at all, which is what
      // the three hardcoded paths did on an image that had none of them.
      if (score == 0) {
        score = 1;
      }
    }
    // Style, within whatever family tier the file landed in. Worth more than the
    // spread between default families but far less than the family tiers, so an
    // OEM's own sans in the right weight beats a recognised name in the wrong
    // one, and the asked-for family beats both.
    bool fileBold = contains(stem, "bold") || contains(stem, "black") || contains(stem, "heavy");
    bool fileItalic = contains(stem, "italic") || contains(stem, "oblique");
    if (fileBold == wantBold) {
      score += 60;
    }
    if (fileItalic == italic) {
      score += 8;
    }
    if (contains(stem, "regular")) {
      score += 4;
    }
    scored.emplace_back(score, static_cast<int>(i));
  }
  // Highest score first; ties keep the (sorted) file order so the same image
  // always resolves the same way.
  std::stable_sort(scored.begin(), scored.end(),
                   [](const auto& a, const auto& b) { return a.first > b.first; });
  std::vector<int> ranked;
  ranked.reserve(scored.size());
  for (const auto& [score, index] : scored) {
    ranked.push_back(index);
  }
  return ranked;
}

FontRegistry& FontRegistry::instance() {
  static FontRegistry registry;
  return registry;
}

std::string FontRegistry::add(std::shared_ptr<tgfx::Typeface> typeface,
                              const std::string& family) {
  if (typeface == nullptr) {
    return {};
  }
  auto name = family.empty() ? typeface->fontFamily() : family;
  if (name.empty()) {
    return {};
  }
  Face face{std::move(typeface), FaceStyle{}};
  face.style = readFaceStyle(face.typeface);
  {
    std::lock_guard<std::mutex> lock(mutex_);
    auto key = fold(name);
    auto& faces = families_[key];
    if (faces.empty()) {
      familyOrder_.push_back(name);
    }
    // Re-registering the same weight+style replaces it, so a hot reload does not
    // stack duplicates that then fight over the match.
    auto same = std::find_if(faces.begin(), faces.end(), [&](const Face& f) {
      return f.style.weight == face.style.weight && f.style.italic == face.style.italic;
    });
    if (same != faces.end()) {
      *same = std::move(face);
    } else {
      faces.push_back(std::move(face));
    }
    // Every cached match may now be stale: the family that just arrived could be
    // the one a scene fell back to the system font for.
    matches_.clear();
  }
  epoch_.fetch_add(1, std::memory_order_release);
  // Bumping the epoch only changes what a draw *decides*; something has to
  // schedule the draw. loadFont() is a bare promise with no commit behind it,
  // so without this a face registered over mounted <Text> would sit unused
  // until the canvas happened to be woken by something else.
  ImageRegistry::instance().wakeAll();
  return name;
}

FontMatch FontRegistry::match(const std::string& family, int weight, bool italic) {
  // The whole resolution runs under this lock, including the one-time directory
  // walk and however many MakeFromPath parses the ranked walk needs. Called from
  // the render thread (buildStack) and the JS thread (measureText), so the first
  // measurement can block the first frame behind a font parse. One-time and
  // bounded; split it if a cold start ever shows up in a trace.
  std::lock_guard<std::mutex> lock(mutex_);
  // Folded, like families_: "PT Serif" and "ptserif" resolve identically, so
  // they must not occupy two entries against the 64 cap.
  auto key = fold(family) + "|" + std::to_string(weight) + "|" + (italic ? "1" : "0");
  auto it = matches_.find(key);
  if (it != matches_.end()) {
    return it->second;
  }
  auto found = resolveLocked(family, weight, italic);
  // ponytail: a flat cap with a full clear, not an LRU — the key space is the
  // families an app actually draws, so this only ever fires on a pathological
  // one, and re-resolving costs a name lookup. LRU it if that stops holding.
  if (matches_.size() >= 64) {
    matches_.clear();
  }
  matches_[key] = found;
  return found;
}

FontMatch FontRegistry::resolveLocked(const std::string& family, int weight, bool italic) {
  FontMatch match;
  auto it = families_.find(fold(family));
  if (it != families_.end() && !it->second.empty()) {
    // matchFamilyStyle: nearest weight, with the asked-for slant preferred over
    // a closer weight in the wrong slant.
    const Face* best = nullptr;
    int bestCost = 0;
    for (const auto& face : it->second) {
      int cost = std::abs(face.style.weight - weight) + (face.style.italic == italic ? 0 : 10000);
      if (best == nullptr || cost < bestCost) {
        best = &face;
        bestCost = cost;
      }
    }
    match.typeface = best->typeface;
    // Synthesise what the family does not ship. 150 is half a weight step: a
    // 500 asked to be 400 is not worth faking, a 400 asked to be 700 is.
    match.fauxBold = weight - best->style.weight >= 150;
    match.fauxItalic = italic && !best->style.italic;
    return match;
  }
  match.typeface = systemTypefaceLocked(family, weight, italic);
  if (match.typeface == nullptr) {
    return match;
  }
  auto style = readFaceStyle(match.typeface);
  match.fauxBold = weight - style.weight >= 150;
  match.fauxItalic = italic && !style.italic;
  return match;
}

std::shared_ptr<tgfx::Typeface> FontRegistry::systemTypefaceLocked(const std::string& family,
                                                                   int weight, bool italic) {
  // CoreGraphics honours family + weight + slant, so Apple resolves here and
  // never reaches the scan. Every FreeType platform returns nullptr from this
  // (SystemFont.cpp is #ifdef _WIN32 inside), which is exactly why the scan
  // below exists rather than a list of file names.
  auto style = tgfx::FontStyle(static_cast<tgfx::FontWeight>(std::clamp(weight, 100, 1000) / 100),
                               tgfx::FontWidth::Normal,
                               italic ? tgfx::FontSlant::Italic : tgfx::FontSlant::Upright);
  if (!family.empty()) {
    if (auto typeface = tgfx::Typeface::MakeFromName(family, style); canDrawText(typeface)) {
      return typeface;
    }
  }
  for (const char* name : kSystemDefaults) {
    if (auto typeface = tgfx::Typeface::MakeFromName(name, style); canDrawText(typeface)) {
      return typeface;
    }
  }
  // Down the ranking until one opens and can draw: a filename says nothing about
  // coverage, and the top-scoring bold face on a real Samsung image is
  // NotoSansCham-Bold, which has no Latin.
  const auto& files = systemFontFiles();
  for (int index : rankFontFiles(files, family, weight, italic)) {
    const auto& path = files[static_cast<size_t>(index)];
    auto cached = files_.find(path);
    // The cache is shared with fallbacks(), which files the colour-emoji face
    // under its path — so a hit has to clear the same bar a fresh open does, or
    // the answer depends on whether a fallback was resolved first.
    if (cached != files_.end()) {
      if (canDrawText(cached->second)) {
        return cached->second;
      }
      continue;
    }
    auto typeface = tgfx::Typeface::MakeFromPath(path);
    if (!canDrawText(typeface)) {
      continue;
    }
    TGFXRN_LOGI("family '%s' weight %d resolved to %s", family.c_str(), weight, path.c_str());
    files_[path] = typeface;
    return typeface;
  }
  TGFXRN_LOGW(
      "no typeface for family '%s': nothing registered, no system match, and no font file that "
      "can draw Latin in any of the platform font directories",
      family.c_str());
  return nullptr;
}

std::vector<std::shared_ptr<tgfx::Typeface>> FontRegistry::fallbacks() {
  std::lock_guard<std::mutex> lock(mutex_);
  if (fallbacksResolved_) {
    return fallbacks_;
  }
  fallbacksResolved_ = true;
  // Apple names it; Android ships it as a file whose name contains "emoji",
  // which the scan finds without knowing the OEM's spelling of it.
  for (const char* name : {"Apple Color Emoji", "Segoe UI Emoji"}) {
    if (auto typeface = tgfx::Typeface::MakeFromName(name, "")) {
      fallbacks_.push_back(std::move(typeface));
      return fallbacks_;
    }
  }
  for (const auto& path : systemFontFiles()) {
    if (!contains(foldedStem(path), "emoji")) {
      continue;
    }
    auto cached = files_.find(path);
    auto typeface = cached != files_.end() ? cached->second : tgfx::Typeface::MakeFromPath(path);
    if (typeface != nullptr) {
      files_[path] = typeface;
      fallbacks_.push_back(std::move(typeface));
      break;
    }
  }
  return fallbacks_;
}

std::vector<std::string> FontRegistry::familyNames() const {
  std::lock_guard<std::mutex> lock(mutex_);
  return familyOrder_;
}

void FontRegistry::clear() {
  {
    std::lock_guard<std::mutex> lock(mutex_);
    families_.clear();
    familyOrder_.clear();
    matches_.clear();
    files_.clear();
    fallbacks_.clear();
    fallbacksResolved_ = false;
  }
  epoch_.fetch_add(1, std::memory_order_release);
}

}  // namespace tgfxrn
