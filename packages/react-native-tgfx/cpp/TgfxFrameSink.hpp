// The only C++ surface this package exports to other native modules.
//
// A frame producer living in a different package — a VisionCamera
// frame-processor plugin, a video decoder, a screen capturer — links this
// library (Android: prefab `react-native-tgfx::NitroTgfx`; iOS: pod
// `NitroTgfx`) and calls setFrame() with the handle a JS-side TgfxImage
// already owns. That is the whole contract.
//
// ImageRegistry itself is deliberately not part of that surface. What this buys
// is narrowness, not a linkage guarantee — be precise about which, because the
// difference matters if anyone ever relies on it:
//
//   * A consumer needs neither the tgfx headers nor the tgfx static library nor
//     the (private) tgfx submodule. Two functions and a plain enum, no
//     dependency on anything under third_party.
//   * Everything else under cpp/ stays unsupported and free to change.
//
// What it does NOT buy is protection against a second registry. `instance()` is
// out-of-line and exported with default visibility (measured: 26 external
// `tgfxrn::ImageRegistry` symbols in libNitroTgfx.so, `instance()` among them),
// so a consumer that vendored ImageRegistry.hpp and linked this library would
// bind to *this* definition and share the table anyway. The prefab simply does
// not ship the header, so the question does not come up.
//
// ponytail: the boundary is a convention, not enforced. Building with
// -fvisibility=hidden and marking these two explicitly default would make it a
// real contract — and would shrink the prefab, which currently publishes a
// 91 MB unstripped debug .so. Worth doing when the release pipeline returns.
#pragma once

#include <cstdint>
#include <memory>

namespace tgfx {
class Image;
}  // namespace tgfx

namespace tgfxrn {

/// How a hardware buffer's planes map to RGB. `RGBA` means the buffer is not
/// YUV at all — a single-plane surface imported with no conversion.
///
/// Camera frames are BT.601; the *range* is the part producers get wrong, so
/// read it from the buffer rather than assuming limited.
enum class FrameFormat : int32_t {
  RGBA = 0,
  BT601Limited,
  BT601Full,
  BT709Limited,
  BT709Full,
  BT2020Limited,
  BT2020Full,
  JPEGFull,
};

/// Point `handle` at `buffer` — an `AHardwareBuffer*` on Android, a
/// `CVPixelBufferRef` on iOS — keeping the handle's id.
///
/// Zero-copy end to end: the buffer is imported straight to a GPU texture with
/// no decode, no CPU staging and no readback, and YUV planes are converted by
/// the fragment shader's samplers rather than by a pre-pass. Nothing here
/// touches JS, so it is safe to call from a camera thread.
///
/// The handle takes its own reference and drops the previous buffer before
/// returning, so a producer recycling a fixed pool gets its slot back on the
/// swap — and a frame the renderer has not drawn yet is superseded rather than
/// queued behind it. The buffer's *contents* must stay unchanged while the
/// handle points at it: tgfx samples it in place.
///
/// Returns false when the import failed, or when `handle` is unknown or was not
/// created from a native buffer. It never throws.
bool setFrame(int32_t handle, uint64_t buffer, FrameFormat format) noexcept;

/// Import `buffer` as a GPU-resident image without touching the registry.
/// Exported for this package's own JS factory, which uses it to mint the first
/// handle; cross-package producers want setFrame() instead.
std::shared_ptr<tgfx::Image> importHardwareBuffer(uint64_t buffer, FrameFormat format);

}  // namespace tgfxrn
