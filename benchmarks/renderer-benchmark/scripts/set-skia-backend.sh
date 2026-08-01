#!/usr/bin/env bash
# Switch @shopify/react-native-skia between its two GPU backends.
#
# react-native-skia picks the backend from a marker file: with libs/.graphite
# present it links the Graphite (Dawn/Vulkan) prebuilts, without it the Ganesh
# (GL) ones. The 2.9.x next-channel tarball ships the marker, so Ganesh also
# needs react-native-skia-android installed (it is a devDependency here).
#
# Usage: bash scripts/set-skia-backend.sh ganesh|graphite
set -euo pipefail

BACKEND="${1:?usage: set-skia-backend.sh ganesh|graphite}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
LIBS="$HERE/node_modules/@shopify/react-native-skia/libs"

case "$BACKEND" in
  ganesh)
    [ -f "$LIBS/.graphite" ] && mv "$LIBS/.graphite" "$LIBS/.graphite.off"
    [ -d "$HERE/node_modules/react-native-skia-android" ] ||
      { echo "ERR: react-native-skia-android is not installed" >&2; exit 1; }
    ;;
  graphite)
    [ -f "$LIBS/.graphite.off" ] && mv "$LIBS/.graphite.off" "$LIBS/.graphite"
    ;;
  *)
    echo "ERR: backend must be ganesh or graphite" >&2
    exit 1
    ;;
esac

# The native build caches the resolved libs path, so force a reconfigure.
rm -rf "$HERE/node_modules/@shopify/react-native-skia/android/build" \
       "$HERE/node_modules/@shopify/react-native-skia/android/.cxx"
echo "skia backend: $BACKEND"
