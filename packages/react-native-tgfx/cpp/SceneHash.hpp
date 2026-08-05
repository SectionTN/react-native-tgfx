#pragma once

#include <cstddef>
#include <cstdint>
#include <span>
#include <string>
#include <vector>

namespace tgfxrn {

namespace scenehash {

constexpr uint64_t kOffset = 14695981039346656037ULL;

inline void mix(uint64_t& hash, const void* data, size_t size) {
  const auto* bytes = static_cast<const unsigned char*>(data);
  for (size_t i = 0; i < size; i++) {
    hash = (hash ^ bytes[i]) * 1099511628211ULL;
  }
}

inline void mixSize(uint64_t& hash, size_t size) {
  auto value = static_cast<uint64_t>(size);
  mix(hash, &value, sizeof(value));
}

}  // namespace scenehash

inline uint64_t hashWords(std::span<const double> words) {
  uint64_t hash = scenehash::kOffset;
  // Length-prefixed so no word can absorb the count that follows it.
  scenehash::mixSize(hash, words.size());
  scenehash::mix(hash, words.data(), words.size() * sizeof(double));
  return hash;
}

inline uint64_t hashStrings(const std::vector<std::string>& strings) {
  uint64_t hash = scenehash::kOffset;
  scenehash::mixSize(hash, strings.size());
  for (const auto& string : strings) {
    // Length-prefixed: "ab","c" and "a","bc" must not collide.
    scenehash::mixSize(hash, string.size());
    scenehash::mix(hash, string.data(), string.size());
  }
  return hash;
}

inline uint64_t hashScene(uint64_t wordsHash, uint64_t stringsHash) {
  uint64_t hash = scenehash::kOffset;
  scenehash::mix(hash, &wordsHash, sizeof(wordsHash));
  scenehash::mix(hash, &stringsHash, sizeof(stringsHash));
  return hash;
}

}  // namespace tgfxrn
