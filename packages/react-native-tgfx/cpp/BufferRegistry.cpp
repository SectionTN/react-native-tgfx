#include "BufferRegistry.hpp"

namespace tgfxrn {

BufferRegistry& BufferRegistry::instance() {
  static BufferRegistry registry;
  return registry;
}

int32_t BufferRegistry::add(std::shared_ptr<SharedFloats> block) {
  std::lock_guard<std::mutex> lock(mutex_);
  int32_t id = next_++;
  blocks_[id] = std::move(block);
  return id;
}

void BufferRegistry::remove(int32_t id) {
  std::lock_guard<std::mutex> lock(mutex_);
  blocks_.erase(id);
}

std::shared_ptr<SharedFloats> BufferRegistry::acquire(int32_t id) {
  std::lock_guard<std::mutex> lock(mutex_);
  auto it = blocks_.find(id);
  return it == blocks_.end() ? nullptr : it->second;
}

}  // namespace tgfxrn
