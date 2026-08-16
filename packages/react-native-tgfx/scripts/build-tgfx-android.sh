#!/bin/bash
# Builds tgfx from source for Android, merges tgfx + its vendored static libs
# into one archive per ABI, and writes them where android/CMakeLists.txt links
# them as imported libraries — so an npm install never compiles tgfx:
#
#   android/libs/<abi>/libtgfx.a          OpenGL ES backend (all ABIs)
#   android/libs-vulkan/<abi>/libtgfx.a   Vulkan backend (64-bit ABIs only:
#                                         TGFX_USE_VULKAN does not compile on
#                                         32-bit targets)
#
# Run once before publishing:
#
#   bash packages/react-native-tgfx/scripts/build-tgfx-android.sh
#
# TGFX_BACKENDS="gl vulkan" selects which backends build (default both);
# positional args override the GL ABI list, VULKAN_ABIS the Vulkan one.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PKG="$(cd "$HERE/.." && pwd)"
TGFX_DIR="$PKG/cpp/third_party/tgfx"
MIN_SDK="${MIN_SDK:-23}"
BACKENDS="${TGFX_BACKENDS:-gl vulkan}"
ABIS=("$@")
[ ${#ABIS[@]} -eq 0 ] && ABIS=(armeabi-v7a arm64-v8a x86 x86_64)
VULKAN_ABIS=(${VULKAN_ABIS:-arm64-v8a x86_64})

# Pinned to React Native 0.86's NDK (libs.versions.toml), also what the example
# app builds with. NDK 29's clang 20 rejects the vendored highway's SVE code
# (RectSIMD.cpp fails on DFromV<__SVBool_t>), so don't bump blindly.
NDK_VERSION="${NDK_VERSION:-27.1.12297006}"
NDK="${ANDROID_NDK_HOME:-}"
if [ -z "$NDK" ]; then
  SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
  NDK="$SDK/ndk/$NDK_VERSION"
fi
[ -f "$NDK/build/cmake/android.toolchain.cmake" ] || { echo "NDK not found — set ANDROID_NDK_HOME" >&2; exit 1; }
AR="$(ls "$NDK"/toolchains/llvm/prebuilt/*/bin/llvm-ar | head -1)"
STRIP="$(ls "$NDK"/toolchains/llvm/prebuilt/*/bin/llvm-strip | head -1)"
echo ">>> NDK: $NDK"

# Two edits to vendor_tools' vendor.cmake (not patches: third_party/ is
# gitignored and re-fetched by depsync, so nothing here is tracked):
# 1. vendor-build guesses its source dir from argv[1], which breaks under
#    workspace symlinks — force `-s ${CONFIG_DIR}`.
# 2. Its arch table has no `i686` case, so the x86 ABI would silently link
#    armeabi-v7a vendored archives.
node -e '
const fs = require("fs"), f = process.argv[1]
let s = fs.readFileSync(f, "utf8"), o = s
if (!s.includes("vendor-build -s "))
  s = s.split("node ${VENDOR_TOOLS_DIR}/vendor-build ").join("node ${VENDOR_TOOLS_DIR}/vendor-build -s ${CONFIG_DIR} ")
if (!s.includes("i686"))
  s = s.replace(
    "    elseif (CMAKE_SYSTEM_PROCESSOR STREQUAL \"x86_64\")\n        set(ARCH x64)\n    else ()",
    "    elseif (CMAKE_SYSTEM_PROCESSOR STREQUAL \"x86_64\")\n        set(ARCH x64)\n    elseif (CMAKE_SYSTEM_PROCESSOR STREQUAL \"i686\")\n        set(ARCH x86)\n    else ()")
if (!s.includes("i686")) { console.error("vendor.cmake i686 patch no longer applies — upstream reshaped the arch table"); process.exit(1) }
if (s !== o) fs.writeFileSync(f, s)
' "$TGFX_DIR/third_party/vendor_tools/vendor.cmake"

# shaderc is only needed by the Metal/Vulkan/WebGPU backends, but tgfx's CMake
# unconditionally git-syncs its sub-deps; satisfy the existence check for the
# GL build. The Vulkan build compiles shaderc for real, so its sub-deps must
# actually be synced (release.sh runs depsync).
mkdir -p "$TGFX_DIR/third_party/shaderc/third_party/glslang"

build_abi() { # abi backend(gl|vulkan)
  local abi="$1" backend="$2"
  local build_dir="$PKG/build/android-$backend-$abi" out_dir="$PKG/android/libs"
  local gl=ON vulkan=OFF platform="$MIN_SDK"
  if [ "$backend" = vulkan ]; then
    gl=OFF; vulkan=ON; out_dir="$PKG/android/libs-vulkan"
    # libvulkan.so enters the NDK sysroot at API 24; find_library fails below it.
    [ "$platform" -lt 24 ] && platform=24
    [ -f "$TGFX_DIR/third_party/shaderc/third_party/glslang/CMakeLists.txt" ] || {
      echo ">>> shaderc sub-deps are not synced (needed by the Vulkan backend):" >&2
      echo ">>>   cd $TGFX_DIR && npx depsync" >&2; exit 1; }
  fi

  # Same feature set android/CMakeLists.txt uses when it builds tgfx from
  # source: SVG on, embedded codecs on (tgfx only declares the codec options
  # for desktop targets, but the `if (TGFX_USE_*)` checks read the cache
  # entries regardless — without them Canvas.snapshot()/save() returns null
  # and decoding falls back to BitmapFactory, dropping EXIF).
  cmake -S "$TGFX_DIR" -B "$build_dir" -G Ninja \
    -DCMAKE_TOOLCHAIN_FILE="$NDK/build/cmake/android.toolchain.cmake" \
    -DANDROID_ABI="$abi" -DANDROID_PLATFORM="android-$platform" \
    -DANDROID_STL=c++_shared -DANDROID_CPP_FEATURES="rtti exceptions" \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_CXX_FLAGS="-fstack-protector-all" -DCMAKE_C_FLAGS="-fstack-protector-all" \
    -DTGFX_USE_OPENGL=$gl -DTGFX_USE_METAL=OFF -DTGFX_USE_VULKAN=$vulkan -DTGFX_USE_WEBGPU=OFF -DTGFX_USE_QT=OFF \
    -DTGFX_BUILD_LAYERS=ON -DTGFX_BUILD_SVG=ON -DTGFX_BUILD_PDF=ON -DTGFX_BUILD_HELLO2D=OFF \
    -DTGFX_USE_PNG_ENCODE=ON -DTGFX_USE_JPEG_ENCODE=ON -DTGFX_USE_WEBP_ENCODE=ON \
    -DTGFX_USE_PNG_DECODE=ON -DTGFX_USE_JPEG_DECODE=ON -DTGFX_USE_WEBP_DECODE=ON

  cmake --build "$build_dir" --target tgfx

  # Merge tgfx + all vendored static libs into one archive (MRI keeps the
  # symbol index across members, so link order stops mattering).
  local libs mri="$build_dir/merge.mri" merged="$build_dir/libtgfx-merged.a"
  libs=$(find "$build_dir" -name '*.a' ! -name 'libtgfx-merged.a' | sort -u)
  echo ">>> [$abi] merging $(echo "$libs" | wc -l | tr -d ' ') static libs"
  {
    echo "create $merged"
    while IFS= read -r l; do echo "addlib $l"; done <<<"$libs"
    echo "save"
    echo "end"
  } >"$mri"
  rm -f "$merged"
  "$AR" -M <"$mri"

  # The embedded-codec guard the old in-tree build asserted via TGFX_DEFINES:
  # if these objects are missing, decoding silently falls back to BitmapFactory.
  # (listed to a file first: grep -q early-exit + pipefail would SIGPIPE llvm-ar)
  "$AR" t "$merged" >"$build_dir/members.txt"
  for obj in JpegCodec WebpCodec PngCodec; do
    grep -q "$obj" "$build_dir/members.txt" || { echo ">>> [$abi] $obj missing from archive — embedded codecs did not build" >&2; exit 1; }
  done

  # NDK compiles with -g even in Release; debug info is ~5x the shippable size.
  "$STRIP" --strip-debug "$merged"

  mkdir -p "$out_dir/$abi"
  cp "$merged" "$out_dir/$abi/libtgfx.a"
  echo ">>> wrote $out_dir/$abi/libtgfx.a ($(du -sh "$out_dir/$abi/libtgfx.a" | cut -f1))"
}

case " $BACKENDS " in *" gl "*)
  for abi in "${ABIS[@]}"; do build_abi "$abi" gl; done
esac
case " $BACKENDS " in *" vulkan "*)
  for abi in "${VULKAN_ABIS[@]}"; do build_abi "$abi" vulkan; done
esac
