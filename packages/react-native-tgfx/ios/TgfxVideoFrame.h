// Registry access for video frames, so Swift can hand a CVPixelBuffer to the
// same handle table <Image> draws from without seeing any C++.
#import <CoreVideo/CoreVideo.h>
#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Point `handle` at `buffer`, or register a new one when `handle` is 0.
/// `format` is a `tgfxrn::FrameFormat`. Returns the handle, 0 on failure.
int32_t TgfxVideoFrameSet(int32_t handle, CVPixelBufferRef buffer, int32_t format);

/// Drops the registry entry. A video's frame is external, so nothing else evicts it.
void TgfxVideoFrameRemove(int32_t handle);

NS_ASSUME_NONNULL_END
