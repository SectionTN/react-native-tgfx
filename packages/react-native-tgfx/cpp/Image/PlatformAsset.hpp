// Bytes for a `require()`d asset that the platform packages under a name rather
// than a path. Only a release Android build does this — it compiles the asset
// into a drawable/raw resource, so `resolveAssetSource` hands JS a bare
// `src_assets_sample` that no file API can open. Android's `asset:` and
// `content:` URIs name no file either, so their bytes come from here too.
#pragma once

#include <memory>
#include <string>

#include "tgfx/core/Data.h"

namespace tgfxrn {

/// True for what `resolveAssetSource` returns for a packaged resource: a bare
/// name, no scheme and no path separator.
inline bool looksLikeAssetName(const std::string& path) {
  return !path.empty() && path.find('/') == std::string::npos &&
         path.find(':') == std::string::npos;
}

/// The asset's bytes, or null when the name names nothing on this platform.
std::shared_ptr<tgfx::Data> platformAssetData(const std::string& name);

/// True for a URI only the platform can read: an APK asset or a content provider's stream.
inline bool looksLikePlatformUri(const std::string& path) {
  return path.rfind("asset:", 0) == 0 || path.rfind("content:", 0) == 0;
}

/// The bytes behind such a URI, or null when this platform cannot read it.
std::shared_ptr<tgfx::Data> platformUriData(const std::string& uri);

}  // namespace tgfxrn
