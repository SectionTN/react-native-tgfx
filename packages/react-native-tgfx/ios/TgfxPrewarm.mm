#import "TgfxPrewarm.h"

#include <cstdlib>
#include <strings.h>

#include "Prewarm.hpp"

namespace {

/// nil when `TGFX_PREWARM` is unset, so an explicit "off" still outranks the Info.plist.
NSNumber* environmentFlag() {
  const char* value = std::getenv("TGFX_PREWARM");
  if (value == nullptr) {
    return nil;
  }
  return @(strcasecmp(value, "1") == 0 || strcasecmp(value, "true") == 0 ||
           strcasecmp(value, "yes") == 0);
}

bool autoPrewarmEnabled() {
  if (NSNumber* flag = environmentFlag()) {
    return flag.boolValue;
  }
  // NSNumber for a plist Boolean, NSString for one written by hand; both answer boolValue.
  id value = [NSBundle.mainBundle objectForInfoDictionaryKey:@"TgfxPrewarm"];
  return [value respondsToSelector:@selector(boolValue)] && [value boolValue];
}

}  // namespace

@implementation TgfxPrewarm

// dyld runs this before main, so an opted-in app needs no launch code of its own.
+ (void)load {
  if (autoPrewarmEnabled()) {
    [self prewarm];
  }
}

+ (void)prewarm {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
      tgfxrn::prewarm();
    });
  });
}

@end
