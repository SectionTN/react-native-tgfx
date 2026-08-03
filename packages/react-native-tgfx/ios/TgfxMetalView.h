// Pure Objective-C interface (no C++ in the header) so it can be imported from
// Swift via the bridging header. The implementation (.mm) is Objective-C++ and
// drives the shared C++ tgfx renderer over a CAMetalLayer.
#pragma once

#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/// Result of a pixel readback. `bytes`/`token` are non-null only on success and
/// only when no output path was given: `bytes` stays valid until the caller
/// passes `token` to `TgfxSnapshotRelease`, which is what lets the pixels reach
/// JS as a zero-copy ArrayBuffer. Called on a worker thread.
typedef void (^TgfxSnapshotCompletion)(void* _Nullable bytes, NSInteger size,
                                       void* _Nullable token, int width,
                                       int height, NSString* _Nullable error);

/// Release the buffer behind a completion's `bytes`. Safe with NULL.
FOUNDATION_EXPORT void TgfxSnapshotRelease(void* _Nullable token);

@interface TgfxMetalView : UIView

/// Update the binary draw-program. `strings` is a string-table delta, not a
/// table: element 0 is the count of leading entries kept (cpp/SceneStrings.hpp).
- (void)setScene:(const double*)words
           count:(NSInteger)count
         strings:(NSArray<NSString*>*)strings;

/// Drop the current program (a recycled view must not flash the old scene).
- (void)clearScene;

/// Composite without an alpha channel, so the layer needs no blending.
- (void)setOpaqueSurface:(BOOL)opaque;

/// Update the live animation value slots (called per frame from a worklet).
- (void)setValues:(const double*)values count:(int32_t)count;

/// Read the canvas back. The readback is issued inside the next frame and
/// collected on a later display-link tick, so this never stalls the render
/// queue; `path` (or nil) selects between saving natively and handing the bytes
/// back. `rect` is in points; a zero-sized rect means the whole canvas.
- (void)snapshotWithFormat:(NSString*)format
                   quality:(int)quality
                      rect:(CGRect)rect
                     scale:(float)scale
                      path:(nullable NSString*)path
                completion:(TgfxSnapshotCompletion)completion;

/// Force an immediate repaint (normally the display link drives frames).
- (void)requestRender;

/// Tear down the display link and GPU resources.
- (void)releaseRenderer;

@end

NS_ASSUME_NONNULL_END
