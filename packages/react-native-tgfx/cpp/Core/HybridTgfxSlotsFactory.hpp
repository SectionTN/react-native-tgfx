// A node handle's flag bytes: one writer, many runtimes reading the same memory, no lock.
#pragma once

#include <NitroModules/ArrayBuffer.hpp>
#include <cstdint>
#include <memory>
#include <vector>

#include "HybridTgfxSlotsFactorySpec.hpp"
#include "HybridTgfxSlotsSpec.hpp"

namespace margelo::nitro::tgfx {

class HybridTgfxSlots : public HybridTgfxSlotsSpec {
 public:
  explicit HybridTgfxSlots(size_t size) : HybridObject(TAG), bytes_(size, 0) {}

  std::shared_ptr<ArrayBuffer> getFlags() override {
    // Borrowed, not owned: this object outlives every view, so a view must not free them.
    return ArrayBuffer::wrap(bytes_.data(), bytes_.size(), []() {});
  }

 private:
  std::vector<uint8_t> bytes_;
};

class HybridTgfxSlotsFactory : public HybridTgfxSlotsFactorySpec {
 public:
  HybridTgfxSlotsFactory() : HybridObject(TAG) {}

  std::shared_ptr<HybridTgfxSlotsSpec> create(double size) override {
    auto count = size > 0 ? static_cast<size_t>(size) : 0;
    return std::make_shared<HybridTgfxSlots>(count);
  }
};

}  // namespace margelo::nitro::tgfx
