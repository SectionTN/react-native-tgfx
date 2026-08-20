# HarfBuzz public headers

The sixteen headers `hb.h` transitively includes, at version **10.1.0**, copied
verbatim from `cpp/third_party/tgfx/third_party/harfbuzz/src`. Nothing else —
no sources, no build files, no platform integrations.

## Why they are here rather than depsync'd

HarfBuzz is already compiled into the prebuilt tgfx archives this package ships
(`android/libs/*/libtgfx.a`, `ios/libs/libtgfx.xcframework`), because tgfx builds
it for its PDF backend. `nm` finds `hb_shape`, `hb_buffer_create` and the
thousand-odd other entry points already exported from both.

What is *not* shipped is a way to declare them. tgfx's own `third_party/` is
fetched by depsync and gitignored, and the npm tarball carries only
`cpp/third_party/tgfx/include` — tgfx's public headers, not its dependencies'.
So `cpp/TextShaping.cpp` had no way to call code that was already linked in.

Copying the headers is what closes that: no new dependency, no new object code,
no second copy of the library. They are a declaration of what the archive
already contains.

## What that costs

The headers and the archive have to agree. If tgfx's HarfBuzz moves to a version
with a different ABI, these go stale silently — the link still succeeds and the
behaviour is undefined. `hb_version_string()` is checked against
`HB_VERSION_STRING` at first use in `TextShaping.cpp`, which turns that into a
warning rather than a mystery.

Refresh them the way they arrived, after a tgfx bump that moves HarfBuzz:

```bash
cd packages/react-native-tgfx
cp cpp/third_party/tgfx/third_party/harfbuzz/src/{hb,hb-blob,hb-buffer,hb-common,hb-deprecated,hb-draw,hb-face,hb-font,hb-map,hb-paint,hb-set,hb-shape-plan,hb-shape,hb-style,hb-unicode,hb-version}.h cpp/third_party/harfbuzz/
cp cpp/third_party/tgfx/third_party/harfbuzz/COPYING cpp/third_party/harfbuzz/
```

## Licence

`COPYING`, alongside these files — the "Old MIT" licence HarfBuzz ships under.
