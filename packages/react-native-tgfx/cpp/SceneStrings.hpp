// The string table travels as a delta; written by packStringTable() in src/compiler/writer.ts.
#pragma once

#include <cstdlib>
#include <memory>
#include <string>
#include <vector>

#include "Log.hpp"

namespace tgfxrn {

using StringTable = std::vector<std::string>;

/// Apply a delta. Held behind `shared_ptr<const>`, so the unchanged case costs a refcount.
inline bool applyStringTable(std::shared_ptr<const StringTable>& table,
                             const StringTable& packed) {
  if (packed.empty()) {
    TGFXRN_LOGW("string table delta has no header, ignoring it");
    return false;
  }
  const size_t held = table->size();
  // Compared before narrowing: `size_t` is 32 bits on armeabi-v7a, where 2^32 + n truncates.
  const unsigned long long carried =
      std::strtoull(packed[0].c_str(), nullptr, 10);
  size_t kept = held;
  if (carried < held) {
    kept = static_cast<size_t>(carried);
  } else if (carried > held) {
    // A dropped delta: everything past `held` is gone, so the words that follow misindex.
    TGFXRN_LOGW("string table delta carries over %llu entries but only %zu are held",
                carried, held);
  }
  if (kept == held && packed.size() == 1) {
    return false;
  }
  auto next = std::make_shared<StringTable>();
  next->reserve(kept + packed.size() - 1);
  next->insert(next->end(), table->begin(), table->begin() + kept);
  next->insert(next->end(), packed.begin() + 1, packed.end());
  table = std::move(next);
  return true;
}

}  // namespace tgfxrn
