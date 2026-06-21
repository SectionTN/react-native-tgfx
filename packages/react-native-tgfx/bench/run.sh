#!/bin/bash
# Native engine performance regression test.
# Generates representative scenes via the real compiler, builds the benchmark,
# and runs 100 rounds. Exits non-zero if performance regresses past the gates.
#
#   bash packages/react-native-tgfx/bench/run.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PKG="$(cd "$HERE/.." && pwd)"
NLO="$PKG/cpp/third_party/tgfx/third_party/json/single_include"

echo ">>> generating scenes (via the real reconciler/compiler)..."
( cd "$PKG" && bun "$HERE/generate-scenes.ts" )

echo ">>> compiling benchmark (-O2)..."
unset TOOLCHAINS 2>/dev/null || true
SDK="$(xcrun --sdk macosx --show-sdk-path 2>/dev/null || true)"
CLANG="/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/clang++"
[ -x "$CLANG" ] || CLANG="$(xcrun -f clang++ 2>/dev/null || command -v clang++)"
"$CLANG" -std=c++20 -O2 ${SDK:+-isysroot "$SDK"} -I "$NLO" \
  "$HERE/engine-bench.cpp" -o "$HERE/engine-bench"

echo ">>> running 100-round regression..."
"$HERE/engine-bench" "$HERE/scenes"
