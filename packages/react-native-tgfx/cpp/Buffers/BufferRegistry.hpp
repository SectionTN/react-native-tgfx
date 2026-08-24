// Shared float blocks the draw program refers to by id; see TgfxBuffer.nitro.ts.
#pragma once

#include <cstdint>
#include <memory>
#include <mutex>
#include <unordered_map>
#include <vector>

namespace tgfxrn {

/**
 * The allocation behind a `TgfxBuffer`. JS writes the floats through a view
 * over the same memory; the render thread reads them at draw. Plain floats —
 * a torn sprite mid-write draws one frame slightly off, which bulk particle
 * data tolerates by design (publish counts last for a coherent frame).
 */
struct SharedFloats {
  explicit SharedFloats(size_t size) : data(size, 0.0f) {}
  std::vector<float> data;
};

/**
 * id -> allocation. Ownership sits with the JS hybrid object; the registry
 * keeps a shared_ptr too, dropped on dispose, so a frame already holding the
 * pointer finishes safely after the JS side lets go.
 */
class BufferRegistry {
 public:
  static BufferRegistry& instance();

  int32_t add(std::shared_ptr<SharedFloats> block);
  void remove(int32_t id);
  std::shared_ptr<SharedFloats> acquire(int32_t id);

 private:
  std::mutex mutex_;
  int32_t next_ = 1;
  std::unordered_map<int32_t, std::shared_ptr<SharedFloats>> blocks_;
};

}  // namespace tgfxrn
