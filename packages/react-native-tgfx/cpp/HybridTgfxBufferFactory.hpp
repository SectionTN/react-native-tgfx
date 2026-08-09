// A shared float block for bulk per-frame data; see TgfxBuffer.nitro.ts.
#pragma once

#include <NitroModules/ArrayBuffer.hpp>
#include <memory>

#include "BufferRegistry.hpp"
#include "HybridTgfxBufferFactorySpec.hpp"
#include "HybridTgfxBufferSpec.hpp"

namespace margelo::nitro::tgfx {

class HybridTgfxBuffer : public HybridTgfxBufferSpec {
 public:
  explicit HybridTgfxBuffer(size_t size)
      : HybridObject(TAG),
        block_(std::make_shared<tgfxrn::SharedFloats>(size)),
        id_(tgfxrn::BufferRegistry::instance().add(block_)) {}

  ~HybridTgfxBuffer() override {
    tgfxrn::BufferRegistry::instance().remove(id_);
  }

  double getId() override {
    return static_cast<double>(id_);
  }

  double getSize() override {
    return static_cast<double>(block_->data.size());
  }

  std::shared_ptr<ArrayBuffer> getBuffer() override {
    // Borrowed: the block outlives every view through the registry shared_ptr.
    auto block = block_;
    return ArrayBuffer::wrap(reinterpret_cast<uint8_t*>(block->data.data()),
                             block->data.size() * sizeof(float),
                             [block]() {});
  }

 private:
  std::shared_ptr<tgfxrn::SharedFloats> block_;
  int32_t id_;
};

class HybridTgfxBufferFactory : public HybridTgfxBufferFactorySpec {
 public:
  HybridTgfxBufferFactory() : HybridObject(TAG) {}

  std::shared_ptr<HybridTgfxBufferSpec> create(double size) override {
    auto count = size > 0 ? static_cast<size_t>(size) : 0;
    return std::make_shared<HybridTgfxBuffer>(count);
  }
};

}  // namespace margelo::nitro::tgfx
