// A node handle's flag bytes, in native memory every JS runtime can read.
//
// The block is allocated once and never moves, and getFlags() wraps it without
// copying — so the JS thread, the UI thread and a camera frame processor each
// get their own ArrayBuffer object over the *same* bytes. A store on one is
// visible to the others immediately, with no publish step and nothing to go
// stale, which is what a Reanimated SharedValue cannot offer across runtimes.
//
// Single writer (the scene compiler, on the JS thread), many readers. Flags are
// one byte each rather than packed bits so a store is indivisible and a reader
// can never observe a half-written value; no lock is needed for that, which is
// the point, since one of the readers is a camera thread.
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
    // Borrowed, not owned: the bytes outlive every view because this object
    // owns them, so the view must not free them when it is collected.
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
