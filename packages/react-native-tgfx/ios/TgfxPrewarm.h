#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Public entry points that do not need a React context or a JS runtime.
@interface TgfxPrewarm : NSObject

/**
 * Builds the Metal device and the font table on a background queue, so the
 * first canvas only has to make its layer. Idempotent, and touches no JSI, so
 * it is safe from `application:didFinishLaunchingWithOptions:`.
 *
 * Setting `TgfxPrewarm` to `YES` in the app's Info.plist calls this before
 * `main` instead, which needs no launch code at all. The `TGFX_PREWARM`
 * environment variable overrides that key in both directions, for measuring
 * one build with and without.
 */
+ (void)prewarm;

@end

NS_ASSUME_NONNULL_END
