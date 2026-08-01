#!/usr/bin/env bash
# Assemble and install the release APK.
#
# react-native-tgfx is a `file:` dependency. Gradle reported
# createBundleReleaseJsAndAssets UP-TO-DATE after a package change once and
# shipped the previous bundle, producing an APK that paired new native code with
# old JS: it installed, ran, and only showed up as nonsense benchmark numbers.
#
# That has not reproduced since — a content change under packages/react-native-
# tgfx/src does re-run the task, so Gradle does track the package through the
# node_modules symlink. Declaring the package as an explicit task input was tried
# and made no difference, and an mtime-based staleness assertion false-positives
# on any touch that leaves content identical. So the bundle is simply dropped
# before every build: one forced re-bundle is cheap next to a silently wrong
# measurement.
#
# To check an APK by hand, grep the packaged bundle for a string you just
# removed:
#   unzip -p app/build/outputs/apk/release/app-release.apk \
#     assets/index.android.bundle | grep -a '<removed literal>'
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
SERIAL="${ANDROID_SERIAL:-RZCW30KE1NB}"

rm -f "$HERE/android/app/build/generated/assets/react/release/index.android.bundle"
cd "$HERE/android"
./gradlew assembleRelease -x lint
adb -s "$SERIAL" install -r app/build/outputs/apk/release/app-release.apk
