// A node handle's flag bytes and value slots: writers and readers on different
// runtimes share the same memory, so a write is a store and a read is a load.
#pragma once

#include <NitroModules/ArrayBuffer.hpp>
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#include "HybridTgfxSlotsFactorySpec.hpp"
#include "HybridTgfxSlotsSpec.hpp"

namespace margelo::nitro::tgfx {

class HybridTgfxSlots : public HybridTgfxSlotsSpec {
 public:
  explicit HybridTgfxSlots(size_t size, size_t valueCount, size_t stringCount)
      : HybridObject(TAG),
        bytes_(size, 0),
        values_(std::make_shared<std::vector<double>>(valueCount, 0.0)),
        strings_(stringCount) {}

  std::shared_ptr<ArrayBuffer> getFlags() override {
    // Borrowed, not owned: only JS typed-array views read the flags, and they hold this object.
    return ArrayBuffer::wrap(bytes_.data(), bytes_.size(), []() {});
  }

  std::shared_ptr<ArrayBuffer> getValues() override {
    // Shared, not borrowed: a canvas binds these for its per-frame push and can outlive this object.
    auto values = values_;
    return ArrayBuffer::wrap(reinterpret_cast<uint8_t*>(values->data()), values->size() * sizeof(double),
                             [values]() {});
  }

  std::string getString(double at) override {
    auto i = static_cast<size_t>(at);
    std::lock_guard<std::mutex> lock(stringsMutex_);
    return i < strings_.size() ? strings_[i] : std::string();
  }

  void setString(double at, const std::string& value) override {
    auto i = static_cast<size_t>(at);
    std::lock_guard<std::mutex> lock(stringsMutex_);
    if (i < strings_.size()) {
      strings_[i] = value;
    }
  }

 private:
  std::vector<uint8_t> bytes_;
  std::shared_ptr<std::vector<double>> values_;
  std::vector<std::string> strings_;
  // Doubles need no lock (an aligned 8-byte store is indivisible); strings do.
  std::mutex stringsMutex_;
};

class HybridTgfxSlotsFactory : public HybridTgfxSlotsFactorySpec {
 public:
  HybridTgfxSlotsFactory() : HybridObject(TAG) {}

  std::shared_ptr<HybridTgfxSlotsSpec> create(double size, double valueCount,
                                              double stringCount) override {
    auto count = size > 0 ? static_cast<size_t>(size) : 0;
    auto values = valueCount > 0 ? static_cast<size_t>(valueCount) : 0;
    auto strings = stringCount > 0 ? static_cast<size_t>(stringCount) : 0;
    return std::make_shared<HybridTgfxSlots>(count, values, strings);
  }
};

}  // namespace margelo::nitro::tgfx
