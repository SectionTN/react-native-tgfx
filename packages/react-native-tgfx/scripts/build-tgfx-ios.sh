#!/bin/bash
# Builds tgfx (Metal backend) from source for iOS device (arm64) and Simulator
# (arm64), merges each slice + its vendored static libs into one static archive,
# and packages both as libtgfx.xcframework which the podspec links via
# `vendored_frameworks`. Run this once before `pod install`:
#
#   bash packages/react-native-tgfx/scripts/build-tgfx-ios.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PKG="$(cd "$HERE/.." && pwd)"
TGFX_DIR="$PKG/cpp/third_party/tgfx"
OUT_DIR="$PKG/ios/libs"
DEPLOY="${DEPLOY:-15.1}"

echo ">>> tgfx: $TGFX_DIR"

# One merged archive per slice. PLATFORM uses tgfx's bundled ios.toolchain.cmake:
# OS64 = arm64 device, SIMULATORARM64 = arm64 iOS Simulator (sets
# SDK_NAME=iphonesimulator + aarch64 so vendor.cmake derives arm64-simulator).
build_slice() {
  local platform="$1" build_dir="$PKG/build/ios-$2"

  # Configure (Metal backend, no OpenGL/Vulkan) via tgfx's iOS toolchain.
  # The encode options are forced on: tgfx only declares them for desktop targets
  # (`if (IOS OR WEB)` gives iOS webp *decode* and nothing else), because Apple
  # decoding goes through ImageIO — but nothing behind ImageCodec::Encode does, so
  # without these Canvas.snapshot()/save() would fail at runtime with a null
  # encode. The `if (TGFX_USE_*_ENCODE)` checks read the cache entry whether or
  # not `option()` declared it.
  cmake -S "$TGFX_DIR" -B "$build_dir" -G Ninja \
    -DCMAKE_TOOLCHAIN_FILE="$TGFX_DIR/third_party/vendor_tools/ios.toolchain.cmake" \
    -DPLATFORM="$platform" \
    -DDEPLOYMENT_TARGET="$DEPLOY" \
    -DCMAKE_BUILD_TYPE=Release \
    -DTGFX_USE_METAL=ON -DTGFX_USE_OPENGL=OFF -DTGFX_USE_VULKAN=OFF -DTGFX_USE_WEBGPU=OFF \
    -DTGFX_BUILD_LAYERS=OFF -DTGFX_BUILD_SVG=OFF -DTGFX_BUILD_PDF=OFF -DTGFX_BUILD_HELLO2D=OFF \
    -DTGFX_USE_PNG_ENCODE=ON -DTGFX_USE_JPEG_ENCODE=ON -DTGFX_USE_WEBP_ENCODE=ON

  cmake --build "$build_dir" --target tgfx

  # Merge tgfx + all vendored static libs into one fat-free static archive.
  local libs
  libs=$(find "$build_dir" -name '*.a' | sort -u)
  echo ">>> [$platform] merging $(echo "$libs" | wc -l | tr -d ' ') static libs"
  libtool -static -o "$build_dir/libtgfx-ios.a" $libs
}

build_slice OS64 device-arm64
build_slice SIMULATORARM64 sim-arm64

# Same arch on both sides, so lipo can't fat them — an xcframework keeps the
# slices apart and lets Xcode pick per destination.
mkdir -p "$OUT_DIR"
rm -rf "$OUT_DIR/libtgfx.xcframework" "$OUT_DIR/libtgfx-ios.a"
xcodebuild -create-xcframework \
  -library "$PKG/build/ios-device-arm64/libtgfx-ios.a" \
  -library "$PKG/build/ios-sim-arm64/libtgfx-ios.a" \
  -output "$OUT_DIR/libtgfx.xcframework"
echo ">>> wrote $OUT_DIR/libtgfx.xcframework ($(du -sh "$OUT_DIR/libtgfx.xcframework" | cut -f1))"
