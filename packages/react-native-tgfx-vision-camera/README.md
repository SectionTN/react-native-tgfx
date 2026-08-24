# react-native-tgfx-vision-camera

A native [VisionCamera](https://visioncamera.margelo.com) frame-processor plugin
that hands camera frames to [`react-native-tgfx`](../react-native-tgfx) **without
JS on the per-frame path**.

```
camera thread ──▶ HybridTgfxCameraSink ──▶ tgfxrn::setFrame ──▶ ImageRegistry ──▶ renderer
```

No worklet, no JS runtime, no pointer laundered through a number.

## When you want this, and when you do not

**Use the native sink when nothing in JS needs the frame; use
`useCameraFrame()` when something does.**

That is a hard boundary, not a preference. `setOnFrameCallback` holds exactly
**one** callback — a single `private var onFrame` on Android, a single
`delegate.onFrame` on iOS, with no chaining and no getter. Installing the native
callback *removes* the JS one, so a screen running `detectFaces(frame)` every
frame cannot have both. Two camera outputs would mean two buffer pools and a
second copy of every frame, which defeats the point.

| the frame processor… | use |
| --- | --- |
| runs a detector, classifier, tracker — anything in JS per frame | `useCameraFrame()` |
| only needs the frame on the canvas | this package |

Both are the same zero-copy import; the difference is only who calls it. When JS
is already on the path for a detector, this package buys nothing — the import is
one Nitro call inside a worklet that had to run anyway.

## Install

```sh
npm i react-native-tgfx-vision-camera
cd ios && pod install
```

`react-native-tgfx`, `react-native-vision-camera` (>= 5.2) and
`react-native-nitro-modules` are peers.

## Use

It composes with `useCameraFrame()` from `react-native-tgfx` rather than
replacing it:

```tsx
import { CameraFrame, Canvas, useCameraFrame } from 'react-native-tgfx'
import { useTgfxCameraSink } from 'react-native-tgfx-vision-camera'

const { image, posture, onFrame } = useCameraFrame()
const sink = useTgfxCameraSink()

const frameOutput = useFrameOutput({
  pixelFormat: 'yuv',
  enablePhysicalBufferRotation: true,
  onFrame,
})

useEffect(() => {
  if (image != null) sink.attach(frameOutput, image.handle)
}, [sink, frameOutput, image])

// ...
;<CameraFrame image={image} {...posture} />
```

The hook's worklet mints the handle from the first frame; `attach()` then
replaces that worklet with a native callback, and no later frame reaches JS.

### Why the first frame is still JS

`imageFromNativeBuffer` needs a buffer, and there is no buffer before the first
frame. Minting the handle natively instead would mean the handle only exists
*after* the camera starts, which JS would then have to be told about — a
callback, on the same path this exists to empty.

### Posture is read once, so set `enablePhysicalBufferRotation`

Because frames stop reaching JS, so does `frame.orientation`. With
`enablePhysicalBufferRotation: true` the pipeline rotates the buffers itself and
`orientation` stays `'up'` for the session, so reading the posture from the first
frame stays true. Without it, orientation changes mid-session and this package
will not tell you — use `useCameraFrame()` instead.

### `pixelFormat: 'yuv'`, never `'rgb'`

`'rgb'` forces a YUV→RGB conversion in the camera pipeline on every frame — a
full-frame copy, which is the one thing this path exists to avoid. tgfx samples
the YUV planes directly, converting in the fragment shader. The colour *range*
is read per frame from `Frame.pixelFormat` rather than assumed.

### No tile modes on the frame

A YUV image sampled with any tile mode other than clamp comes back fully
transparent at the pinned tgfx. Nothing here exposes one.

## How it reaches tgfx's C++

`react-native-tgfx` exports exactly one header, `cpp/Render/TgfxFrameSink.hpp`:

```cpp
namespace tgfxrn {
enum class FrameFormat : int32_t { RGBA, BT601Limited, BT601Full, /* … */ };
bool setFrame(int32_t handle, uint64_t buffer, FrameFormat format) noexcept;
}
```

- **Android** — a prefab, `react-native-tgfx::NitroTgfx`. `find_package` +
  `target_link_libraries` in `android/CMakeLists.txt`.
- **iOS** — `s.dependency 'NitroTgfx'`, with the header found through CocoaPods'
  per-pod header dir.

The registry itself is deliberately not part of that surface. The point is
narrowness, not a linkage guarantee: this package links `libNitroTgfx.so` rather
than compiling any of it, so it needs neither the tgfx headers, nor the tgfx
static library, nor the private tgfx submodule — and everything else under
`cpp/` stays unsupported and free to change.

It is *not* a defence against a second registry. `ImageRegistry::instance()` is
out-of-line and exported with default visibility, so a package that vendored the
header and linked this library would bind to the same definition and share the
table anyway. The prefab just does not ship the header. Making that a real
contract wants `-fvisibility=hidden`, which is a follow-up.
