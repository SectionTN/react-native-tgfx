#include "PlatformAsset.hpp"

#if !defined(__ANDROID__)

namespace tgfxrn {

// Only Android packages an asset under a name; every other platform resolves a
// `require()` to a real file, which the caller's own path handling already opens.
std::shared_ptr<tgfx::Data> platformAssetData(const std::string&) {
  return nullptr;
}

// `asset:` and `content:` are Android's; no other platform hands them out.
std::shared_ptr<tgfx::Data> platformUriData(const std::string&) {
  return nullptr;
}

}  // namespace tgfxrn

#endif
