#import "TgfxMetalView.h"

#import <CoreVideo/CoreVideo.h>
#import <Metal/Metal.h>
#import <QuartzCore/CAMetalLayer.h>

#include <algorithm>
#include <atomic>
#include <cstdint>
#include <memory>
#include <span>
#include <string>
#include <vector>

#include "IdleGate.hpp"
#include "Snapshot.hpp"
#include "TgfxRenderer.hpp"
#include "tgfx/gpu/metal/MetalWindow.h"

// The completion's `token` is the encoded buffer's owning reference, handed to
// Swift so ArrayBuffer.wrap can keep the bytes alive without a copy.
void TgfxSnapshotRelease(void* token) {
  delete static_cast<std::shared_ptr<tgfx::Data>*>(token);
}

@implementation TgfxMetalView {
  std::unique_ptr<tgfxrn::TgfxRenderer> _renderer;
  CADisplayLink* _displayLink;
  // GPU work runs here, not on the main thread: the display link only enqueues.
  dispatch_queue_t _renderQueue;
  std::atomic<bool> _drawPending;
  tgfxrn::IdleGate _idleGate;
  std::atomic<bool> _windowBound;
  // Set once the display link is gone: a snapshot staged after that would never
  // get the frame it needs, so it is rejected instead of hanging.
  std::atomic<bool> _released;
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
  // The display link pauses itself after a few idle ticks, so a change nobody
  // committed — the next camera frame behind a hardware-buffer handle, or an
  // evicted image finishing its re-decode — has to unpause it or it is never
  // drawn. Weak, because the renderer is owned by the view.
  __weak __typeof(self) weakSelf = self;
  _renderer->setWakeCallback([weakSelf] { [weakSelf wakeUp]; });
  _windowBound = false;
  _released = false;
  _drawPending = false;
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
  auto tick = _idleGate.tick(_drawPending.load(std::memory_order_acquire));
  if (tick == tgfxrn::IdleGate::Tick::Pause) {
    _displayLink.paused = YES;
  }
  if (tick != tgfxrn::IdleGate::Tick::Draw) {
    return;
  }
  if (_drawPending.exchange(true)) {
    return;
  }
  dispatch_async(_renderQueue, ^{
    [self bindWindowIfNeeded];
    bool snapshotPending = false;
    if (self->_renderer != nullptr) {
      self->_renderer->draw();
      snapshotPending = self->_renderer->snapshotPending();
    }
    self->_drawPending = false;
    // A GPU→CPU transfer needs another tick to land, and the idle gate would
    // otherwise pause the link before it does.
    if (snapshotPending) {
      [self wakeUp];
    }
  });
}

// Callable from any thread; the display link belongs to the main run loop.
- (void)wakeUp {
  _idleGate.wake();
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
    // As on Android: this also drops the string-table delta, which JS has
    // already committed to and cannot resend. Only reachable on a null/empty
    // buffer, and the next delta warns in applyStringTable. Do not add a third
    // early return above _renderer->setScene without routing the delta in.
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

- (void)snapshotWithFormat:(NSString*)format
                   quality:(int)quality
                      rect:(CGRect)rect
                     scale:(float)scale
                      path:(NSString*)path
                completion:(TgfxSnapshotCompletion)completion {
  if (_renderer == nullptr || _released) {
    completion(nullptr, 0, nullptr, 0, 0,
               @"[tgfx] snapshot: the canvas is no longer mounted");
    return;
  }
  tgfxrn::SnapshotRequest request;
  request.format = format.UTF8String;
  request.quality = quality;
  request.x = static_cast<float>(rect.origin.x);
  request.y = static_cast<float>(rect.origin.y);
  request.width = static_cast<float>(rect.size.width);
  request.height = static_cast<float>(rect.size.height);
  request.scale = scale;
  request.path = path != nil ? path.UTF8String : "";
  auto deliver = [completion](std::shared_ptr<tgfx::Data> data, int width, int height,
                              const std::string& error) {
    if (!error.empty()) {
      completion(nullptr, 0, nullptr, 0, 0, @(error.c_str()));
      return;
    }
    if (data == nullptr) {
      completion(nullptr, 0, nullptr, width, height, nil);
      return;
    }
    // Ownership moves to the token; Swift releases it when the ArrayBuffer it
    // wraps is collected.
    auto* token = new std::shared_ptr<tgfx::Data>(std::move(data));
    completion(const_cast<void*>((*token)->data()),
               static_cast<NSInteger>((*token)->size()), token, width, height, nil);
  };
  // The surface tgfx renders into is the layer's drawable, and a CAMetalLayer
  // hands out framebuffer-only drawables by default — blitting out of one is
  // illegal and wedges the whole Metal device, not just this view, and it stays
  // wedged across a relaunch. The property only binds to drawables acquired
  // after it is set, and a frame already recording on the render queue can be
  // holding an older one (a blur or backdrop materialises the render target
  // mid-scene, well before the readback is issued). So the flip is paired with
  // deferSnapshotsToNextSurface(): the request is held staged until a surface
  // created after the flip exists, which is one extra surface recreation, once
  // per canvas. Flipped once and left off — it costs the drawable's lossless
  // compression on every later frame, but restoring it would put that surface
  // recreation on every snapshot, and a canvas nobody reads back never pays.
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self->_renderer == nullptr || self->_released) {
      deliver(nullptr, 0, 0, "[tgfx] snapshot: the canvas is no longer mounted");
      return;
    }
    CAMetalLayer* layer = [self metalLayer];
    if (layer.framebufferOnly) {
      layer.framebufferOnly = NO;
      self->_renderer->deferSnapshotsToNextSurface();
    }
    self->_renderer->requestSnapshot(request, deliver);
    [self wakeUp];
  });
}

- (void)requestRender {
  [self wakeUp];
}

- (void)releaseRenderer {
  [_displayLink invalidate];
  _displayLink = nil;
  _windowBound = false;
  _released = true;
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
