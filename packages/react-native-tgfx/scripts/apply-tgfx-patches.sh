#!/usr/bin/env bash
# Apply the tracked tgfx patches to the submodule working tree.
#
# Idempotent: a patch that is already applied is skipped, so this is safe to run
# from a build step or postinstall.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
TGFX="$HERE/cpp/third_party/tgfx"
PATCHES="$HERE/patches"

# Sources, not .git: an npm tarball ships tgfx as plain files, and git apply needs no repo.
[ -e "$TGFX/CMakeLists.txt" ] || { echo "tgfx sources missing: no $TGFX/CMakeLists.txt" >&2; exit 1; }

# Under node_modules the consumer's own repo is an ancestor; without a ceiling git
# would discover it, resolve patch paths against its toplevel, and skip every hunk.
export GIT_CEILING_DIRECTORIES="${TGFX%/*}"

for patch in "$PATCHES"/*.patch; do
  [ -e "$patch" ] || continue
  name="$(basename "$patch")"
  if git -C "$TGFX" apply --reverse --check "$patch" 2>/dev/null; then
    echo "already applied: $name"
  elif git -C "$TGFX" apply --check "$patch" 2>/dev/null; then
    git -C "$TGFX" apply "$patch"
    echo "applied: $name"
  else
    echo "ERROR: $name does not apply cleanly to the current tgfx checkout" >&2
    exit 1
  fi
done
