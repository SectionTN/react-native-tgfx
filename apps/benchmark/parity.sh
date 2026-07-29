#!/usr/bin/env bash
# Pixel-parity check: tgfx vs Skia rendering the same static scenes at the same
# size, both on screen at once. One screenshot per scene, two fixed crops,
# numeric diff. Repeats N rounds (default 5).
#
# Usage: bash parity.sh [rounds] [serial]
set -uo pipefail

PKG=com.tgfxbench
HERE="$(cd "$(dirname "$0")" && pwd)"
ROUNDS="${1:-5}"
DEV="${2:-$(adb devices | awk 'NR==2{print $1}')}"
[ -z "$DEV" ] && { echo "ERR: no device" >&2; exit 1; }
A() { adb -s "$DEV" "$@"; }

PY="${PARITY_PY:-python3}"
OUT="${PARITY_OUT:-/tmp/tgfx_parity}"
rm -rf "$OUT"; mkdir -p "$OUT"

A shell svc power stayon true >/dev/null 2>&1
A shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1
A shell cmd statusbar collapse >/dev/null 2>&1

for round in $(seq 1 "$ROUNDS"); do
  echo ">>> round $round/$ROUNDS"
  TMPLOG=$(mktemp /tmp/tgfxparity_XXXXXX.log)
  A logcat -c 2>/dev/null
  A logcat -s ReactNativeJS --format=raw >> "$TMPLOG" 2>/dev/null &
  LOGPID=$!
  A shell am force-stop "$PKG" >/dev/null 2>&1
  sleep 0.5
  A shell am start -n "$PKG/.MainActivity" -e mode parity >/dev/null 2>&1
  A shell cmd statusbar collapse >/dev/null 2>&1

  LAYOUT=""
  while IFS= read -r line; do
    case "$line" in
      *PARITY_LAYOUT*)
        LAYOUT="$line"
        echo "$LAYOUT" > "$OUT/layout.txt"
        ;;
      *PARITY_SCENE*)
        name=$(echo "$line" | sed -n 's/.*name=\([a-z]*\).*/\1/p')
        sleep 1.2
        A exec-out screencap -p > "$OUT/r${round}_${name}.png" 2>/dev/null
        ;;
      *PARITY_DONE*)
        break
        ;;
    esac
  done < <(tail -f "$TMPLOG")
  kill "$LOGPID" 2>/dev/null
  rm -f "$TMPLOG"
done

A shell svc power stayon false >/dev/null 2>&1
"$PY" "$HERE/paritydiff.py" "$OUT"
