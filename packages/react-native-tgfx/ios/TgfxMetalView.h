// Pure Objective-C interface (no C++ in the header) so it can be imported from
// Swift via the bridging header. The implementation (.mm) is Objective-C++ and
// drives the shared C++ tgfx renderer over a CAMetalLayer.
#pragma once

#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

@interface TgfxMetalView : UIView

/// Update the compiled JSON draw-program.
- (void)setSceneJSON:(NSString*)json;

/// Update the live animation value slots (called per frame from a worklet).
- (void)setValues:(NSArray<NSNumber*>*)values;

/// Force an immediate repaint (normally the display link drives frames).
- (void)requestRender;

/// Tear down the display link and GPU resources.
- (void)releaseRenderer;

@end

NS_ASSUME_NONNULL_END
