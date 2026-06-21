#import "TgfxMetalView.h"

#import <Metal/Metal.h>
#import <QuartzCore/CAMetalLayer.h>

#include <memory>
#include <string>

#include "TgfxRenderer.hpp"
#include "tgfx/gpu/metal/MetalWindow.h"

@implementation TgfxMetalView {
  std::unique_ptr<tgfxrn::TgfxRenderer> _renderer;
  CADisplayLink* _displayLink;
  BOOL _windowBound;
  int _idleFrames;
}

+ (Class)layerClass {
  return [CAMetalLayer class];
}

- (CAMetalLayer*)metalLayer {
  return (CAMetalLayer*)self.layer;
}

- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    [self commonInit];
  }
  return self;
}

- (instancetype)initWithCoder:(NSCoder*)coder {
  if (self = [super initWithCoder:coder]) {
    [self commonInit];
  }
  return self;
}

- (void)commonInit {
  _renderer = std::make_unique<tgfxrn::TgfxRenderer>();
  _windowBound = NO;
  self.contentScaleFactor = UIScreen.mainScreen.nativeScale;
  self.opaque = NO;
  CAMetalLayer* layer = [self metalLayer];
  layer.device = MTLCreateSystemDefaultDevice();
  layer.pixelFormat = MTLPixelFormatBGRA8Unorm;
  layer.contentsScale = self.contentScaleFactor;

  _displayLink = [CADisplayLink displayLinkWithTarget:self
                                             selector:@selector(render)];
  [_displayLink addToRunLoop:NSRunLoop.mainRunLoop
                     forMode:NSRunLoopCommonModes];
}

- (void)layoutSubviews {
  [super layoutSubviews];
  CGFloat scale = self.contentScaleFactor;
  CGSize size = self.bounds.size;
  CAMetalLayer* layer = [self metalLayer];
  layer.contentsScale = scale;
  layer.drawableSize = CGSizeMake(size.width * scale, size.height * scale);
  if (_renderer != nullptr) {
    _renderer->onResize();
  }
  [self wakeUp];
}

- (void)bindWindowIfNeeded {
  if (_windowBound || _renderer == nullptr) {
    return;
  }
  CAMetalLayer* layer = [self metalLayer];
  if (layer.drawableSize.width <= 0 || layer.drawableSize.height <= 0) {
    return;
  }
  auto window = tgfx::MetalWindow::MakeFrom(layer);
  if (window != nullptr) {
    _renderer->setWindow(window);
    _windowBound = YES;
  }
}

- (void)render {
  [self bindWindowIfNeeded];
  bool didDraw = (_renderer != nullptr) && _renderer->draw();
  if (didDraw) {
    _idleFrames = 0;
  } else {
    _idleFrames++;
  }
  // Pause the display link after a few idle frames; -wakeUp resumes it.
  if (_idleFrames > 3) {
    _displayLink.paused = YES;
  }
}

- (void)wakeUp {
  _idleFrames = 0;
  if (_displayLink != nil) {
    _displayLink.paused = NO;
  }
}

- (void)setSceneJSON:(NSString*)json {
  if (_renderer != nullptr && json != nil) {
    _renderer->setScene(std::string(json.UTF8String));
  }
  [self wakeUp];
}

- (void)setValues:(NSArray<NSNumber*>*)values {
  if (_renderer == nullptr || values == nil) {
    return;
  }
  std::vector<double> v;
  v.reserve(values.count);
  for (NSNumber* n in values) {
    v.push_back(n.doubleValue);
  }
  _renderer->setValues(v);
  [self wakeUp];
}

- (void)requestRender {
  [self wakeUp];
}

- (void)releaseRenderer {
  [_displayLink invalidate];
  _displayLink = nil;
  _windowBound = NO;
  if (_renderer != nullptr) {
    _renderer->releaseWindow();
  }
}

- (void)dealloc {
  [self releaseRenderer];
}

@end
