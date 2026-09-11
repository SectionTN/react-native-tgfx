// Builds the process-wide GPU device and the font table before the first canvas mounts.
#pragma once

#include <memory>

namespace tgfx {
class VulkanDevice;
}

namespace tgfxrn {

/**
 * Does the expensive, view-independent half of a canvas's first frame: the GPU
 * device (driver load, VkInstance/VkDevice or MTLDevice) and the system font
 * table. Idempotent, and safe from any thread — but never the main one, since
 * the driver load alone can cost tens of milliseconds.
 */
void prewarm();

#if defined(__ANDROID__) && defined(TGFX_RN_VULKAN)
/// The VkInstance/VkDevice every canvas window in the process shares; built on first call.
std::shared_ptr<tgfx::VulkanDevice> sharedVulkanDevice();
#endif

}  // namespace tgfxrn
