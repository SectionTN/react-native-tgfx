#include "Prewarm.hpp"

#include <chrono>
#include <mutex>

#include "FontRegistry.hpp"
#include "Log.hpp"
#include "TextLayout.hpp"

#if defined(__APPLE__)
#include "tgfx/gpu/metal/MetalDevice.h"
#elif defined(TGFX_RN_VULKAN)
#include "tgfx/gpu/vulkan/VulkanDevice.h"
#else
#include "tgfx/gpu/opengl/GLDevice.h"
#endif

namespace tgfxrn {
namespace {

using Clock = std::chrono::steady_clock;

double msSince(Clock::time_point start) {
  return std::chrono::duration<double, std::milli>(Clock::now() - start).count();
}

/// Costs a driver load, so it is held for the process rather than rebuilt per canvas.
void warmDevice() {
#if defined(__APPLE__)
  static auto device = tgfx::MetalDevice::Make();
  (void)device;
#elif defined(TGFX_RN_VULKAN)
  sharedVulkanDevice();
#else
  static auto device = tgfx::GLDevice::Make();
  (void)device;
#endif
}

/// Walks the platform font dirs, opens the default face and the emoji fallback,
/// and shapes one word so HarfBuzz has built its face and plan.
void warmText() {
  FontRegistry::instance().fallbacks();
  TextRun run;
  run.text = "Ag";
  layoutText({run}, TextSpec{}, 16.0f);
}

}  // namespace

#if defined(__ANDROID__) && defined(TGFX_RN_VULKAN)
std::shared_ptr<tgfx::VulkanDevice> sharedVulkanDevice() {
  static auto device = tgfx::VulkanDevice::Make();
  return device;
}
#endif

void prewarm() {
  static std::once_flag once;
  std::call_once(once, [] {
    auto start = Clock::now();
    warmDevice();
    double gpuMs = msSince(start);
    auto textStart = Clock::now();
    warmText();
    TGFXRN_LOGI("prewarm: gpu %.1f ms, text %.1f ms, total %.1f ms", gpuMs, msSince(textStart),
                msSince(start));
  });
}

}  // namespace tgfxrn
