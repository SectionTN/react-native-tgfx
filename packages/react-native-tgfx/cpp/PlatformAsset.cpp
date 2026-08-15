#include "PlatformAsset.hpp"

#if !defined(__ANDROID__)

namespace tgfxrn {

// Only Android packages an asset under a name; every other platform resolves a
// `require()` to a real file, which the caller's own path handling already opens.
std::shared_ptr<tgfx::Data> platformAssetData(const std::string&) {
  return nullptr;
}

}  // namespace tgfxrn

#endif
