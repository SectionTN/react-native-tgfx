// The string table is sent as a delta, because it carries the payloads that
// scale with content rather than node count (base64 image data, path data) and
// they are byte-identical across commits. Element 0 of the transported array is
// the number of leading entries the engine already holds; the rest replaces
// everything after them. Written by packStringTable() in src/compiler/writer.ts.
#pragma once

#include <cstdlib>
#include <memory>
#include <string>
#include <vector>

#include "Log.hpp"

namespace tgfxrn {

using StringTable = std::vector<std::string>;

/// Apply a transported delta. The table is held behind a `shared_ptr<const>` so
/// the unchanged case — the one the delta exists for — reaches the render thread
/// by refcount instead of re-copying every payload. A change replaces the
/// pointer (copy-on-write) and returns true; otherwise `table` is left alone and
/// false is returned. `table` must never be null.
inline bool applyStringTable(std::shared_ptr<const StringTable>& table,
                             const StringTable& packed) {
  if (packed.empty()) {
    // packStringTable always writes a header, so this is a hand-rolled caller.
    TGFXRN_LOGW("string table delta has no header, ignoring it");
    return false;
  }
  const size_t held = table->size();
  // Compared before narrowing: `size_t` is 32 bits on armeabi-v7a, where a count
  // of 2^32 + n truncates to n, lands under `held` and slips past the warning.
  const unsigned long long carried =
      std::strtoull(packed[0].c_str(), nullptr, 10);
  size_t kept = held;
  if (carried < held) {
    kept = static_cast<size_t>(carried);
  } else if (carried > held) {
    // The sender thinks the engine holds more than it does: a dropped delta.
    // Everything past `held` is gone, so the words that follow will misindex.
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
