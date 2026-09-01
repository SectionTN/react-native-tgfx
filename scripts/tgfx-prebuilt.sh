#!/bin/bash
# Prebuilt tgfx artifacts, cached in a public Cloudflare R2 bucket, so a clone
# without access to the private tgfx submodule can still build the example app:
# the tarball carries the same android/libs + ios/libs the build scripts write,
# plus tgfx's public headers (android/CMakeLists.txt and the podspec both add
# cpp/third_party/tgfx/include to their search paths).
#
#   bash scripts/tgfx-prebuilt.sh            # download + extract (skips if current)
#   bash scripts/tgfx-prebuilt.sh upload     # after build-tgfx-{ios,android}.sh
#
# The object key is the submodule's pinned commit, so bumping the submodule
# misses the cache and falls back to building from source.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG="$ROOT/packages/react-native-tgfx"
SUBMODULE="packages/react-native-tgfx/cpp/third_party/tgfx"
BUCKET="${TGFX_PREBUILT_BUCKET:-react-native-tgfx-prebuilt}"
# Public base URL of $BUCKET — `wrangler r2 bucket dev-url enable` prints it,
# and so does the upload below. Replace with a custom domain when there is one.
BASE_URL="${TGFX_PREBUILT_URL:-https://pub-51ab65c551a54296b3296849fbb8cf5f.r2.dev}"

SHA="$(git -C "$ROOT" ls-tree HEAD -- "$SUBMODULE" | awk '{print $3}')"
[ -n "$SHA" ] || { echo "no gitlink for $SUBMODULE — not a git checkout?" >&2; exit 1; }
# v2: the tarball also carries the Vulkan prebuilts (android/libs-vulkan).
KEY="tgfx-${SHA:0:12}-v2.tar.gz"
STAMP="$PKG/build/.prebuilt-sha"

# Relative to $PKG so the tarball extracts straight back over the package.
PATHS=(
  ios/libs
  android/libs
  android/libs-vulkan
  cpp/third_party/tgfx/include
  cpp/third_party/tgfx/LICENSE.txt
)

wrangler() {
  npx  wrangler@4 "$@"
}

if [ "${1:-download}" = upload ]; then
  for p in "${PATHS[@]}"; do
    [ -e "$PKG/$p" ] || { echo "missing $p — run build-tgfx-ios.sh and build-tgfx-android.sh first" >&2; exit 1; }
  done
  mkdir -p "$PKG/build"
  TARBALL="$PKG/build/$KEY"
  tar -czf "$TARBALL" -C "$PKG" "${PATHS[@]}"
  echo ">>> $KEY ($(du -sh "$TARBALL" | cut -f1))"

  # Both are no-ops once they have run; keeps a fresh account one command away.
  wrangler r2 bucket create "$BUCKET" 2>/dev/null || true
  wrangler r2 bucket dev-url enable "$BUCKET" --force 2>/dev/null || true

  wrangler r2 object put "$BUCKET/$KEY" --file "$TARBALL" --remote \
    --content-type application/gzip --cache-control "public, max-age=31536000, immutable"
  echo "$SHA" >"$STAMP"
  wrangler r2 bucket dev-url get "$BUCKET"
  echo ">>> set TGFX_PREBUILT_URL (or BASE_URL in this script) to that r2.dev URL"
  exit 0
fi

if [ "$(cat "$STAMP" 2>/dev/null)" = "$SHA" ] && [ -f "$PKG/ios/libs/libtgfx.xcframework/Info.plist" ]; then
  echo ">>> tgfx prebuilt ${SHA:0:12} already extracted"
  exit 0
fi

mkdir -p "$PKG/build"
TARBALL="$PKG/build/$KEY"
echo ">>> GET $BASE_URL/$KEY"
if ! curl -fsSL --retry 3 -o "$TARBALL.part" "$BASE_URL/$KEY"; then
  rm -f "$TARBALL.part"
  echo "no prebuilt tgfx for ${SHA:0:12} at $BASE_URL — build from source instead:" >&2
  echo "  bash $PKG/scripts/build-tgfx-ios.sh && bash $PKG/scripts/build-tgfx-android.sh" >&2
  exit 1
fi
mv "$TARBALL.part" "$TARBALL"

tar -xzf "$TARBALL" -C "$PKG"
for p in ios/libs/libtgfx.xcframework/Info.plist android/libs-vulkan/arm64-v8a/libtgfx.a cpp/third_party/tgfx/include/tgfx; do
  [ -e "$PKG/$p" ] || { echo "tarball is missing $p" >&2; exit 1; }
done
echo "$SHA" >"$STAMP"
rm -f "$TARBALL"
echo ">>> extracted tgfx prebuilt ${SHA:0:12} into $PKG"
