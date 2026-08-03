#!/bin/bash
# Builds tgfx (Metal backend) from source for the iOS Simulator (arm64) and
# merges it + its vendored static libs into a single libtgfx-ios.a that the
# podspec links via `vendored_libraries`. Run this once before `pod install`:
#
#   bash packages/react-native-tgfx/scripts/build-tgfx-ios.sh
#
# For a device build, change SYSROOT to `iphoneos` and ARCH to `arm64`.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PKG="$(cd "$HERE/.." && pwd)"
TGFX_DIR="$PKG/cpp/third_party/tgfx"
BUILD_DIR="$PKG/build/ios-sim-arm64"
OUT_DIR="$PKG/ios/libs"
# PLATFORM uses tgfx's bundled ios.toolchain.cmake: SIMULATORARM64 = arm64 iOS
# Simulator (sets SDK_NAME=iphonesimulator + aarch64 so vendor.cmake derives
# arm64-simulator). Use OS64 for a device build.
PLATFORM="${PLATFORM:-SIMULATORARM64}"
DEPLOY="${DEPLOY:-15.1}"

echo ">>> tgfx: $TGFX_DIR"
echo ">>> platform=$PLATFORM deployment=$DEPLOY"

# 1) Apply the tracked tgfx patches; idempotent, and loud if one stops applying.
bash "$HERE/apply-tgfx-patches.sh"

# 2) Configure (Metal backend, no OpenGL/Vulkan) via tgfx's iOS toolchain.
# The encode options are forced on: tgfx only declares them for desktop targets
# (`if (IOS OR WEB)` gives iOS webp *decode* and nothing else), because Apple
# decoding goes through ImageIO — but nothing behind ImageCodec::Encode does, so
# without these Canvas.snapshot()/save() would fail at runtime with a null
# encode. The `if (TGFX_USE_*_ENCODE)` checks read the cache entry whether or
# not `option()` declared it.
cmake -S "$TGFX_DIR" -B "$BUILD_DIR" -G Ninja \
  -DCMAKE_TOOLCHAIN_FILE="$TGFX_DIR/third_party/vendor_tools/ios.toolchain.cmake" \
  -DPLATFORM="$PLATFORM" \
  -DDEPLOYMENT_TARGET="$DEPLOY" \
  -DCMAKE_BUILD_TYPE=Release \
  -DTGFX_USE_METAL=ON -DTGFX_USE_OPENGL=OFF -DTGFX_USE_VULKAN=OFF -DTGFX_USE_WEBGPU=OFF \
  -DTGFX_BUILD_LAYERS=OFF -DTGFX_BUILD_SVG=OFF -DTGFX_BUILD_PDF=OFF -DTGFX_BUILD_HELLO2D=OFF \
  -DTGFX_USE_PNG_ENCODE=ON -DTGFX_USE_JPEG_ENCODE=ON -DTGFX_USE_WEBP_ENCODE=ON

# 3) Build the tgfx static lib (pulls in the tgfx-vendor target).
cmake --build "$BUILD_DIR" --target tgfx

# 4) Merge tgfx + all vendored static libs into one fat-free static archive.
mkdir -p "$OUT_DIR"
LIBS=$(find "$BUILD_DIR" -name '*.a' | sort -u)
echo ">>> merging $(echo "$LIBS" | wc -l | tr -d ' ') static libs into libtgfx-ios.a"
libtool -static -o "$OUT_DIR/libtgfx-ios.a" $LIBS
echo ">>> wrote $OUT_DIR/libtgfx-ios.a ($(du -h "$OUT_DIR/libtgfx-ios.a" | cut -f1))"
