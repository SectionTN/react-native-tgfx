#!/bin/sh
# react-native-skia 3.0.0 links libwebgpu_dawn.so but its Graphite binaries don't ship it; react-native-webgpu 0.10.4 carries the same chrome-m154 Dawn.
set -e
cd "$(dirname "$0")/.."
dst="$(node -p "require('path').dirname(require.resolve('react-native-skia-graphite-android/package.json', { paths: [require('path').dirname(require.resolve('react-native-skia/package.json'))] }))")/libs/arm64-v8a"
[ -f "$dst/libwebgpu_dawn.so" ] && exit 0
tmp="$(mktemp -d)"
(cd "$tmp" && npm pack react-native-webgpu@0.10.4 >/dev/null 2>&1 && tar xzf react-native-webgpu-0.10.4.tgz package/libs/android/arm64-v8a/libwebgpu_dawn.so)
cp "$tmp/package/libs/android/arm64-v8a/libwebgpu_dawn.so" "$dst/"
rm -rf "$tmp"
echo "install-dawn: copied libwebgpu_dawn.so to $dst"
