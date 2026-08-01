#import "TgfxMetalView.h"

#import <CoreVideo/CoreVideo.h>
#import <Metal/Metal.h>
#import <QuartzCore/CAMetalLayer.h>

#include <algorithm>
#include <atomic>
#include <memory>
#include <span>
#include <string>
#include <vector>

#include "TgfxRenderer.hpp"
#include "tgfx/gpu/metal/MetalWindow.h"

@implementation TgfxMetalView {
  std::unique_ptr<tgfxrn::TgfxRenderer> _renderer;
  CADisplayLink* _displayLink;
  // GPU work runs here, not on the main thread: the display link only enqueues.
  dispatch_queue_t _renderQueue;
  std::atomic<bool> _drawPending;
  std::atomic<int> _idleFrames;
  std::atomic<bool> _windowBound;
  std::atomic<double> _drawableWidth;
  std::atomic<double> _drawableHeight;
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
  _windowBound = false;
  _drawPending = false;
  _idleFrames = 0;
  _drawableWidth = 0;
  _drawableHeight = 0;
  _renderQueue = dispatch_queue_create("tgfx.render", DISPATCH_QUEUE_SERIAL);
  dispatch_set_target_queue(
      _renderQueue, dispatch_get_global_queue(QOS_CLASS_USER_INTERACTIVE, 0));
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
  // Cached so the render thread never reads a CALayer property.
  _drawableWidth = size.width * scale;
  _drawableHeight = size.height * scale;
  if (_renderer != nullptr) {
    // Scene coordinates are logical points; the drawable is in physical pixels.
    _renderer->setPixelRatio(static_cast<float>(scale));
    _renderer->onResize();
  }
  [self wakeUp];
}

- (void)bindWindowIfNeeded {
  if (_windowBound || _renderer == nullptr) {
    return;
  }
  if (_drawableWidth <= 0 || _drawableHeight <= 0) {
    return;
  }
  auto window = tgfx::MetalWindow::MakeFrom([self metalLayer]);
  if (window != nullptr) {
    _renderer->setWindow(window);
    _windowBound = true;
  }
}

// Main thread: hand the frame to the render queue and return immediately. A
// frame still in flight is not queued twice, so a slow frame cannot pile up.
- (void)render {
  if (_idleFrames > 3) {
    _displayLink.paused = YES;
    return;
  }
  if (_drawPending.exchange(true)) {
    return;
  }
  dispatch_async(_renderQueue, ^{
    [self bindWindowIfNeeded];
    bool didDraw = (self->_renderer != nullptr) && self->_renderer->draw();
    self->_idleFrames = didDraw ? 0 : self->_idleFrames.load() + 1;
    self->_drawPending = false;
  });
}

// Callable from any thread; the display link belongs to the main run loop.
- (void)wakeUp {
  _idleFrames = 0;
  if (_displayLink == nil) {
    return;
  }
  if (NSThread.isMainThread) {
    _displayLink.paused = NO;
    return;
  }
  dispatch_async(dispatch_get_main_queue(), ^{
    self->_displayLink.paused = NO;
  });
}

- (void)setScene:(const double*)words
           count:(NSInteger)count
         strings:(NSArray<NSString*>*)strings {
  if (_renderer == nullptr || words == nullptr || count <= 0) {
    return;
  }
  std::vector<std::string> table;
  table.reserve(strings.count);
  for (NSString* string in strings) {
    table.emplace_back(string.UTF8String);
  }
  _renderer->setScene(std::span<const double>(words, static_cast<size_t>(count)),
                      table);
  [self wakeUp];
}

- (void)setOpaqueSurface:(BOOL)opaque {
  self.opaque = opaque;
  [self metalLayer].opaque = opaque;
  if (_renderer != nullptr) {
    _renderer->setOpaque(opaque);
  }
  [self wakeUp];
}

- (void)clearScene {
  if (_renderer != nullptr) {
    _renderer->clearScene();
  }
  [self wakeUp];
}

- (void)setValues:(const double*)values count:(int32_t)count {
  if (_renderer != nullptr && values != nullptr) {
    _renderer->setValues(std::vector<double>(values, values + count));
  }
  [self wakeUp];
}

- (void)drawCameraFrame:(void*)buffer
             frameWidth:(float)frameWidth
            frameHeight:(float)frameHeight
               contours:(const float*)contours
                  count:(NSInteger)count
             blurRadius:(float)blurRadius {
  if (_renderer == nullptr || buffer == nullptr) {
    return;
  }
  // The frame processor releases its buffer as soon as this returns, so the
  // pixel buffer is retained for the hop to the render queue. The contour list
  // is the caller's memory too, so it is copied here.
  auto pixelBuffer = CVPixelBufferRetain(static_cast<CVPixelBufferRef>(buffer));
  std::vector<float> shapes(contours, contours + std::max<NSInteger>(count, 0));
  dispatch_async(_renderQueue, ^{
    [self bindWindowIfNeeded];
    if (self->_renderer != nullptr) {
      self->_renderer->drawCameraFrame(pixelBuffer, frameWidth, frameHeight, shapes,
                                       blurRadius);
    }
    CVPixelBufferRelease(pixelBuffer);
  });
}

- (void)requestRender {
  [self wakeUp];
}

- (void)releaseRenderer {
  [_displayLink invalidate];
  _displayLink = nil;
  _windowBound = false;
  if (_renderer == nullptr) {
    return;
  }
  // Wait for any in-flight frame before tearing the GPU resources down.
  dispatch_sync(_renderQueue, ^{
    self->_renderer->releaseWindow();
  });
}

- (void)dealloc {
  [self releaseRenderer];
}

@end
