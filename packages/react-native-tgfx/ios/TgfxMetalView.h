// Pure Objective-C interface (no C++ in the header) so it can be imported from
// Swift via the bridging header. The implementation (.mm) is Objective-C++ and
// drives the shared C++ tgfx renderer over a CAMetalLayer.
#pragma once

#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

@interface TgfxMetalView : UIView

/// Update the binary draw-program and its string table.
- (void)setScene:(const double*)words
           count:(NSInteger)count
         strings:(NSArray<NSString*>*)strings;

/// Drop the current program (a recycled view must not flash the old scene).
- (void)clearScene;

/// Composite without an alpha channel, so the layer needs no blending.
- (void)setOpaqueSurface:(BOOL)opaque;

/// Update the live animation value slots (called per frame from a worklet).
- (void)setValues:(const double*)values count:(int32_t)count;

/// Draw a camera frame, blurring the interior of each contour. `buffer` is a
/// `CVPixelBufferRef`; `contours` is a flat polygon list (point count, then that
/// many x,y pairs, per shape) in frame pixel coordinates.
- (void)drawCameraFrame:(void*)buffer
             frameWidth:(float)frameWidth
            frameHeight:(float)frameHeight
               contours:(const float*)contours
                  count:(NSInteger)count
             blurRadius:(float)blurRadius;

/// Force an immediate repaint (normally the display link drives frames).
- (void)requestRender;

/// Tear down the display link and GPU resources.
- (void)releaseRenderer;

@end

NS_ASSUME_NONNULL_END
