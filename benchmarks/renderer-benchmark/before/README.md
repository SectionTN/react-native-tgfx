# The "before" side of the bitmap A/B

The `tgfx-images` numbers compare two image transports: `main`'s base64 payload
in the scene's string table, and this branch's native handle. The library is the
only thing that changes. The benchmark app — the scene, the four 256×256
textures, the button labels the harness drives, the acceptance gate — stays
byte-identical, so nothing else can account for a difference.

Reproducing the before side is therefore two commands and one file swap, from a
checkout of this branch:

```sh
# 1. Put the library back to main's base64 transport.
git checkout main -- packages/react-native-tgfx

# 2. Use the renderer written against that API.
cp benchmarks/renderer-benchmark/before/TgfxImagesRenderer.tsx \
   benchmarks/renderer-benchmark/src/renderers/TgfxImagesRenderer.tsx

# 3. Build and run exactly as the after side does.
cd benchmarks/renderer-benchmark
./scripts/build-android.sh
node scripts/run-quick.mjs --tag=images-before --renderers=tgfx-images --reps=3
node scripts/pixel-gate.mjs --tag=images-before --renderers=tgfx-images
```

`git restore --source=HEAD packages/react-native-tgfx src/renderers` puts the
after side back.

## What stops this measuring nothing

The first bitmap A/B on this branch published a complete set of frame timings
for a scene that drew no images at all, because the textures came from a
`require()`d asset that never reached the release APK. Two things now have to
hold before a run is accepted:

- `backendProof` for `tgfx-images` is measured, not a literal: the renderer
  publishes how many texture handles it had and how many `<Image>` nodes it
  emitted. `scripts/gate.mjs` rejects a run reporting zero of either, on both
  sides. That is the check that would have caught the empty scene.
- `scripts/pixel-gate.mjs --renderers=tgfx-images` captures the frozen frame on
  each side. `artifacts/frames/images-before-tgfx-images.png` and
  `images-after-tgfx-images.png` are the drawn pixels, committed.

The before side cannot report decoded texture dimensions: `main`'s
`useImage` returns base64 and never exposes them to JS. The count and the node
census are what both sides can be held to, so they are what the gate checks.
