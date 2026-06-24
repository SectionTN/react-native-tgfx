#!/usr/bin/env bash
# tgfx-bench harness — FPS, jank, frame-time percentiles, CPU%, PSS.
#
# Usage:
#   bash measure.sh [adb-serial] [--skip-build]
#
# Logcat is started BEFORE the app launches so no BENCH_START markers are missed.
# The app auto-starts the sweep — no manual tap needed.
#
set -uo pipefail

PKG=com.tgfxbench
APK=android/app/build/outputs/apk/release/app-release.apk

DEV="${1:-$(adb devices | awk 'NR==2{print $1}')}"
[ -z "$DEV" ] && { echo "ERR: no device" >&2; exit 1; }
SKIP_BUILD="${2:-}"

A() { adb -s "$DEV" "$@"; }
CLK=$(A shell getconf CLK_TCK 2>/dev/null | tr -d '\r'); CLK=${CLK:-100}
echo ">>> device=$DEV  abi=$(A shell getprop ro.product.cpu.abi | tr -d '\r')  CLK_TCK=$CLK"

# build unless skipped
if [[ "$SKIP_BUILD" != "--skip-build" ]]; then
  echo ">>> building release APK (arm64-v8a)..."
  (cd android && ./gradlew assembleRelease --no-daemon -PreactNativeArchitectures=arm64-v8a -q) \
    || { echo "ERR: gradle build failed" >&2; exit 1; }
  echo ">>> installing..."
  A install -r "$APK" 2>&1 | tail -1
fi

A shell svc power stayon true  >/dev/null 2>&1
A shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1

# stream logcat to a temp file BEFORE launching — nothing gets missed
TMPLOG=$(mktemp /tmp/tgfx_XXXXXX.log)
A logcat -c 2>/dev/null
A logcat -s ReactNativeJS --format=raw >> "$TMPLOG" 2>/dev/null &
LOGPID=$!
cleanup() { kill "$LOGPID" 2>/dev/null; rm -f "$TMPLOG"; A shell svc power stayon false >/dev/null 2>&1; }
trap cleanup EXIT

echo ">>> cold-launching $PKG..."
A shell am force-stop "$PKG" 2>/dev/null
sleep 0.5
A shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1

echo ">>> waiting for JS bundle..."
for i in $(seq 1 90); do
  grep -q 'TgfxBench' "$TMPLOG" 2>/dev/null && break
  sleep 1
done
echo "    bundle loaded; sweep auto-starting..."
sleep 1

PID=$(A shell pidof "$PKG" | tr -d '\r')
echo ">>> pid=$PID"

# helpers
cpu_jiffies() { A shell cat /proc/"$PID"/stat 2>/dev/null | awk '{print $14+$15}'; }
gfx_frames()  { echo "$1" | sed -n 's/.*Total frames rendered: \([0-9]*\).*/\1/p' | head -1; }
janky_pct()   { echo "$1" | grep -oE 'Janky frames: [0-9]+ \([0-9.]+%\)' | head -1 | grep -oE '[0-9.]+%' | tr -d '%'; }
pct_ms()      { echo "$1" | sed -n "s/.*${2} percentile: \\([0-9]*\\)ms.*/\\1/p" | head -1; }
pss_mb()      {
  local raw
  raw=$(A shell dumpsys meminfo "$PKG" 2>/dev/null | grep 'TOTAL PSS:' | head -1 | grep -oE '[0-9]+' | head -1)
  python3 -c "print(round(${raw:-0}/1024, 1))"
}

printf "\n%-6s %6s %7s %6s %7s %7s %7s %7s %8s\n" lib N fps jank% f50ms f90ms f95ms cpu% pssMB
echo "-----------------------------------------------------------------------"

ROWS=/tmp/tgfx_bench_rows.txt
: > "$ROWS"

cur_lib=""; cur_n=""; t0=""; c0=""

# read from the file that's accumulating in background
while IFS= read -r line; do
  if [[ "$line" == *"BENCH_START"* ]]; then
    cur_lib=$(echo "$line" | sed -n 's/.*lib=\([a-z]*\).*/\1/p')
    cur_n=$(echo   "$line" | sed -n 's/.*n=\([0-9]*\).*/\1/p')
    A shell dumpsys gfxinfo "$PKG" reset >/dev/null 2>&1
    t0=$(python3 -c 'import time; print(time.time())')
    c0=$(cpu_jiffies)
    echo "  [measuring] $cur_lib  n=$cur_n ..."

  elif [[ "$line" == *"BENCH_END"* && -n "$t0" ]]; then
    t1=$(python3 -c 'import time; print(time.time())')
    c1=$(cpu_jiffies)
    dur=$(python3 -c "print($t1 - $t0)")

    gfx=$(A shell dumpsys gfxinfo "$PKG" 2>/dev/null)
    frames=$(gfx_frames "$gfx")
    janky=$(janky_pct "$gfx")
    f50=$(pct_ms "$gfx" "50th"); f90=$(pct_ms "$gfx" "90th"); f95=$(pct_ms "$gfx" "95th")
    pss=$(pss_mb)

    fps=$(python3 -c "print(round(${frames:-0}/$dur, 1))")
    cpu=$(python3 -c "print(round((${c1:-0}-${c0:-0})/$CLK/$dur*100, 1))")

    row=$(printf "%-6s %6s %7s %6s %7s %7s %7s %7s %8s" \
      "$cur_lib" "$cur_n" "$fps" "${janky:--}" "${f50:--}" "${f90:--}" "${f95:--}" "$cpu" "$pss")
    echo "$row" | tee -a "$ROWS"
    t0=""

  elif [[ "$line" == *"BENCH_SWEEP_DONE"* ]]; then
    echo "-----------------------------------------------------------------------"
    echo ">>> sweep done — rows saved to $ROWS"
    kill "$LOGPID" 2>/dev/null
    break
  fi
done < <(tail -f "$TMPLOG")
