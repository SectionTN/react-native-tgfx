#!/usr/bin/env bash
# Assemble and install the release APK.
#
# react-native-tgfx is a `file:` dependency, so its sources live outside every
# path the JS bundle task watches: Gradle reports createBundleReleaseJsAndAssets
# UP-TO-DATE after a package change and ships the previous bundle, which silently
# pairs new native code with old JS. Dropping the generated bundle first makes
# that impossible.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
SERIAL="${ANDROID_SERIAL:-RZCW30KE1NB}"

rm -f "$HERE/android/app/build/generated/assets/react/release/index.android.bundle"
cd "$HERE/android"
./gradlew assembleRelease -x lint
adb -s "$SERIAL" install -r app/build/outputs/apk/release/app-release.apk
