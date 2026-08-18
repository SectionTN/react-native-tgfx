# Troubleshooting

## Blank canvas / `unexpected header`

The JS writer and the C++ reader share a `SCENE_VERSION`. After it changes, an
installed APK containing the old native reader draws nothing.

**It is a stale build, not a render bug. Rebuild the app.**

```bash
unzip -l android/app/build/outputs/apk/release/app-release.apk | grep NitroTgfx
```

A correct Android build contains one `lib/<abi>/libNitroTgfx.so` for each of
`arm64-v8a`, `armeabi-v7a`, `x86`, `x86_64`.

## Shader compile errors

| Message | Cause |
| --- | --- |
| `declarations must come before main(), found after it: '…'` | a helper or declaration sits below `main`; only what precedes `main` is lifted |
| `expected a 'vec4 main(vec2 pos)' entry point` | wrong return type or parameter type; use `half4 main(float2 pos)` |
| `declare one name per statement above main(): '…'` | `float a = 1.0, b = 2.0;` — split it |
| `unsupported declaration above main(): '…'` | the declaration grammar is not recognised (structs are, arrays are not) |
| `unsupported uniform type 'X'` | only `half`/`half2..4`, `float`/`float2..4`, `vec2..4`, `int`, `float2x2`/`3x3`/`4x4`, `shader` |
| `only scalar, vector and square-matrix uniforms are supported, not arrays` | `uniform float k[4];` — flatten or pack |
| `child 'img' may only be used as 'img.eval(coord)' or 'sample(img, coord)'` | the child name appears somewhere else in the source |
| `the source declares N 'uniform shader' … but M shader children were given` | one child per declaration, matched by order |
| `unbalanced braces` | literally that |

Runtime symptoms with no error:

- **Everything black past ~1024 px** — you rebound `pos` yourself at default
  precision. Use the `main` parameter, which is bound at `highp`.
- **A loop does nothing** — GLSL ES will not unroll a loop it cannot size; the
  bounds must be compile-time constants.
- **A gradient/step inverts** — `smoothstep(edge0, edge1, x)` with
  `edge0 > edge1` is undefined; use rising edges and flip the result.

## `two opacities in one chain`

```
[tgfx] two opacities in one chain, at least one animated: a draw command has a
single alpha slot, so their product is frozen at the last commit. Animate one
opacity per chain.
```

Move one opacity onto a `<Group layer>` (which composites first), or fold the
constant one into the color's alpha.

## Camera renders fully transparent

An `<ImageShader>` fed a YUV frame with a tile mode other than `clamp` comes
back fully transparent. Remove `tx`/`ty`.

## Camera renders washed out or with crushed blacks

The color range is wrong: a `-full` frame imported as limited crushes blacks,
and the reverse washes out. `useCameraFrame` reads the producer's
`pixelFormat` string; override with `options.format` if your producer names
formats differently.

On the Android **Vulkan** backend, video frames are converted via a CPU plane
copy and tgfx's own YUV shader on purpose — on at least Mali the driver ignores
the color-range override on zero-copy external-format imports.

## Camera stalls after a few frames

A frame or its buffer was retained. One unreleased buffer stalls the producer's
bounded pool. Inside `onEachFrame`: do not call `getNativeBuffer()`, do not call
`frame.dispose()` (the hook does), do not keep a reference to the frame, never
store `.pointer`.

## Camera preview does not rotate

- With the native sink attached, `frame.orientation` no longer reaches JS and
  `posture` freezes at the first frame. Set
  `enablePhysicalBufferRotation: true`, or stay on `useCameraFrame()` alone.
- `<CameraFrame rotation>` is the clockwise rotation that **cancels**
  `frame.orientation`: `'right'` needs `270`, not `90`.

## The frame output re-registers every render

`useFrameOutput` is memoised on its options object. Memoise your `onEachFrame`
callback with `useCallback`, and never pass an inline `options` object to
`useCameraFrame`.

## Animation runs but nothing moves

- The value is a `SharedValue` holding a **color string** or packed number —
  only `ColorComponents` tuples animate.
- The write went through a prop with no slot, and a React commit then reverted
  it. **The next React commit wins**; drive a value from one side only.
- The canvas is scrolled off-screen on Android: it keeps its surface but skips
  draws until it returns. Slots keep filling; the first frame back picks them up.
- `animator_duration_scale` is 0 on the device — every Reanimated animation
  freezes and it reads exactly like a library bug.

## Scene is slow

In order of impact:

1. Per-frame state going through React instead of slots.
2. Wrapper function components as `<Canvas>` children (the reconciler falls back).
3. `<Group layer>` where no group opacity or filter is needed.
4. Many `<Image>`/`<Circle>` nodes where `<Atlas buffer>` / `<Vertices buffer>`
   would do.
5. Mounting/unmounting nodes instead of pooling handles and toggling `visible`.
6. Shader source strings rebuilt per render, defeating the transpile cache.

## Android release build cannot find an image

Two assets whose file names differ only by extension (`logo.png` beside
`logo.webp`) collide as one Android resource in a release build. Give them
distinct names.

## Memory

`setImageCacheLimit(bytes)` (default 64 MB) applies to both the decoded-pixel
cache and the tgfx GPU resource cache. A decoded image is resident twice — CPU
pixels and the GPU texture. Use `image.scaled(w, h)` for photo grids instead of
drawing a 12 MP source into a 200×200 box, and `dispose()` handles you own.

Native-buffer handles (camera frames) are **not** charged against that budget —
the memory belongs to the producer.

## Repo-local

- `bun run specs` regenerates Nitro bindings; `bun run typecheck` for types.
- Flipping `TGFX_BUILD_*` flags alone leaves the linker without the symbols —
  the prebuilt has to be rebuilt too.
- Never switch git branches while a device build is live; a scene-version
  mismatch blanks the running app.
