#!/bin/bash
# One-shot release: prebuild tgfx for every CPU ABI on both platforms
# (iOS: arm64 device + arm64/x86_64 simulator; Android: armeabi-v7a, arm64-v8a,
# x86, x86_64), publish react-native-tgfx to npm, then deploy the docs site.
# End users install prebuilt binaries — no postinstall, no tgfx compile.
#
# Run from main, logged in to npm (`npm whoami`) and Cloudflare (`wrangler login`):
#
#   bash scripts/release.sh            # release-it prompts for the version bump
#   bash scripts/release.sh minor      # or pass release-it args through
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG="$ROOT/packages/react-native-tgfx"

# tgfx's vendored deps are gitignored; fetch once (no-op when already synced)
(cd "$PKG/cpp/third_party/tgfx" && npx --yes depsync)

echo "=== 1/5 tgfx iOS (arm64 device, arm64+x86_64 simulator) ==="
bash "$PKG/scripts/build-tgfx-ios.sh"

echo "=== 2/5 tgfx Android (GL: armeabi-v7a, arm64-v8a, x86, x86_64 · Vulkan: all four ABIs) ==="
bash "$PKG/scripts/build-tgfx-android.sh"

echo "=== 3/5 cache the prebuilt tgfx artifacts in R2 ==="
bash "$ROOT/scripts/tgfx-prebuilt.sh" upload

echo "=== 4/5 publish react-native-tgfx to npm ==="
# release-it: version bump + changelog + git tag + GitHub release + npm publish
(cd "$PKG" && npx release-it "$@")

echo "=== 5/5 deploy docs ==="
(cd "$ROOT/docs" && bun run deploy)
