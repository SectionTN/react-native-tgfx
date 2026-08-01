#pragma once

#include <cstddef>
#include <cstdint>
#include <span>
#include <string>
#include <vector>

namespace tgfxrn {

/// FNV-1a identity of a draw-program: the words plus the string table they index.
inline uint64_t hashScene(std::span<const double> words,
                          const std::vector<std::string>& strings) {
  uint64_t hash = 14695981039346656037ULL;
  auto mix = [&hash](const void* data, size_t size) {
    const auto* bytes = static_cast<const unsigned char*>(data);
    for (size_t i = 0; i < size; i++) {
      hash = (hash ^ bytes[i]) * 1099511628211ULL;
    }
  };
  auto mixSize = [&mix](size_t size) {
    auto value = static_cast<uint64_t>(size);
    mix(&value, sizeof(value));
  };
  // Length-prefixed so no word can absorb the count that follows it.
  mixSize(words.size());
  mix(words.data(), words.size() * sizeof(double));
  // String indices are re-assigned per commit, so equal words can index a different table.
  mixSize(strings.size());
  for (const auto& string : strings) {
    // Length-prefixed: "ab","c" and "a","bc" must not collide.
    mixSize(string.size());
    mix(string.data(), string.size());
  }
  return hash;
}

}  // namespace tgfxrn
