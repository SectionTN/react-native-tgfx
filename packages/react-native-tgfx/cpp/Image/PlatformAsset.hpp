// Bytes for a `require()`d asset that the platform packages under a name rather
// than a path. Only a release Android build does this — it compiles the asset
// into a drawable/raw resource, so `resolveAssetSource` hands JS a bare
// `src_assets_sample` that no file API can open.
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

}  // namespace tgfxrn
