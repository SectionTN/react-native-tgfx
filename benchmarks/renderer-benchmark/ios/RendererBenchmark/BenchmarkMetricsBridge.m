#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE (BenchmarkMetrics, NSObject)

RCT_EXTERN_METHOD(start
                  : (double)mainThreadPressureMs resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(stop
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(publish : (NSString*)result)

@end
