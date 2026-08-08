// Pure Objective-C so Swift can import it; the .mm drives the C++ renderer over a CAMetalLayer.
#pragma once

#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/// Readback result on a worker thread. `bytes` stays valid until `token` reaches TgfxSnapshotRelease.
typedef void (^TgfxSnapshotCompletion)(void* _Nullable bytes, NSInteger size,
                                       void* _Nullable token, int width,
                                       int height, NSString* _Nullable error);

FOUNDATION_EXPORT void TgfxSnapshotRelease(void* _Nullable token);

@interface TgfxMetalView : UIView

/// Update the draw program. `strings` is a delta, not a table (cpp/SceneStrings.hpp).
- (void)setScene:(const double*)words
           count:(NSInteger)count
         strings:(NSArray<NSString*>*)strings;

- (void)clearScene;

- (void)setOpaqueSurface:(BOOL)opaque;

- (void)setValues:(const double*)values count:(int32_t)count;
- (void)setDisplayP3:(BOOL)displayP3;
- (NSArray<NSNumber*>*)hitTestX:(float)x y:(float)y precise:(BOOL)precise;

/// Read the canvas back, collected on a later tick. `rect` is in points; zero means the whole canvas.
- (void)snapshotWithFormat:(NSString*)format
                   quality:(int)quality
                      rect:(CGRect)rect
                     scale:(float)scale
                      path:(nullable NSString*)path
                completion:(TgfxSnapshotCompletion)completion;

- (void)requestRender;

- (void)releaseRenderer;

@end

NS_ASSUME_NONNULL_END
