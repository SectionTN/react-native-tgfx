#!/bin/bash
# tgfx vs Skia benchmark harness (Android).
#
# Launches the example app, opens the Benchmark screen (which auto-sweeps
# [tgfx,skia] x [shape counts]), and for each config window measures:
#   FPS      = frames rendered (dumpsys gfxinfo) / window seconds
#   jank%    = janky frames (gfxinfo) — perceived smoothness
#   frame ms = 50/90/95/99th percentile total frame time (render-cost proxy)
#   CPU%     = app process CPU time delta (/proc/pid/stat) over the window
#   mem MB   = TOTAL PSS (dumpsys meminfo)
#
# GPU%: not directly available via adb on stock devices; the frame-time
# percentiles (which include GPU execute time) are the render-cost proxy.
#
# Usage: bash benchmark.sh [serial]
set -uo pipefail
PKG=com.tgfxexample
DEV="${1:-$(adb devices | sed -n '2p' | awk '{print $1}')}"
[ -z "$DEV" ] && { echo "no device"; exit 1; }
A(){ adb -s "$DEV" "$@"; }
CLK=$(A shell getconf CLK_TCK 2>/dev/null | tr -d '\r'); CLK=${CLK:-100}
echo ">>> device=$DEV  abi=$(A shell getprop ro.product.cpu.abi | tr -d '\r')  CLK_TCK=$CLK"

# Keep the screen awake.
A shell svc power stayon true >/dev/null 2>&1
A shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1

# Cold launch.
A shell am force-stop $PKG
A reverse tcp:8081 tcp:8081 >/dev/null 2>&1
A logcat -c
A shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
echo ">>> waiting for JS bundle..."
for i in $(seq 1 60); do A logcat -d 2>/dev/null | grep -q "Running application \"TgfxExample\"" && break; sleep 1; done
sleep 4

# Open the Benchmark screen by tapping the button (located via uiautomator).
open_bench(){
  A shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
  local xml; xml=$(A shell cat /sdcard/ui.xml 2>/dev/null)
  local b; b=$(echo "$xml" | tr '>' '\n' | grep -i "Benchmark vs Skia" | grep -oE 'bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' | head -1)
  [ -z "$b" ] && return 1
  local x1 y1 x2 y2
  read -r x1 y1 x2 y2 < <(echo "$b" | grep -oE '[0-9]+' | tr '\n' ' ')
  [ -z "$x2" ] && return 1
  A shell input tap $(((x1+x2)/2)) $(((y1+y2)/2))
  return 0
}
echo ">>> opening Benchmark screen..."
for i in 1 2 3 4 5; do open_bench && { echo "   tapped"; break; }; sleep 1; done
sleep 2

PID=$(A shell pidof $PKG | tr -d '\r')
echo ">>> app pid=$PID"
echo ">>> sweeping (watch on-device). results:"
printf "\n%-6s %-6s %8s %7s %8s %8s %8s %8s %8s\n" lib N fps jank% f50ms f90ms f95ms cpu% pssMB
echo "------------------------------------------------------------------------------------------"

ROWS=/tmp/tgfx_bench_rows.txt; : > "$ROWS"
cpu_jiffies(){ A shell cat /proc/$PID/stat 2>/dev/null | awk '{print $14+$15}'; }
gfx_val(){ echo "$1" | sed -n "s/.*$2: \\([0-9]*\\).*/\\1/p" | head -1; }
pct_ms(){ echo "$1" | sed -n "s/.*$2 percentile: \\([0-9]*\\)ms.*/\\1/p" | head -1; }

cur_lib=""; cur_n=""; t0=""; c0=""
while IFS= read -r line; do
  if [[ "$line" == *"BENCH_START"* ]]; then
    cur_lib=$(echo "$line" | sed -n 's/.*lib=\([a-z]*\).*/\1/p')
    cur_n=$(echo "$line" | sed -n 's/.*n=\([0-9]*\).*/\1/p')
    A shell dumpsys gfxinfo $PKG reset >/dev/null 2>&1
    t0=$(python3 -c 'import time;print(time.time())')
    c0=$(cpu_jiffies)
  elif [[ "$line" == *"BENCH_END"* && -n "$t0" ]]; then
    t1=$(python3 -c 'import time;print(time.time())')
    c1=$(cpu_jiffies)
    dur=$(python3 -c "print($t1-$t0)")
    gfx=$(A shell dumpsys gfxinfo $PKG 2>/dev/null)
    frames=$(gfx_val "$gfx" "Total frames rendered")
    janky=$(echo "$gfx" | grep -oE 'Janky frames: [0-9]+ \([0-9.]+%\)' | head -1 | grep -oE '[0-9.]+%' | tr -d '%')
    f50=$(pct_ms "$gfx" "50th"); f90=$(pct_ms "$gfx" "90th"); f95=$(pct_ms "$gfx" "95th")
    mem=$(A shell dumpsys meminfo $PKG 2>/dev/null | grep -E "TOTAL PSS|TOTAL:" | head -1 | grep -oE '[0-9]+' | head -1)
    fps=$(python3 -c "print(round(${frames:-0}/$dur,1))")
    cpu=$(python3 -c "print(round((${c1:-0}-${c0:-0})/$CLK/$dur*100,1))")
    pss=$(python3 -c "print(round(${mem:-0}/1024,1))")
    printf "%-6s %-6s %8s %7s %8s %8s %8s %8s %8s\n" "$cur_lib" "$cur_n" "$fps" "${janky:-?}" "${f50:-?}" "${f90:-?}" "${f95:-?}" "$cpu" "$pss" | tee -a "$ROWS"
    t0=""
  elif [[ "$line" == *"BENCH_SWEEP_DONE"* ]]; then
    echo "------------------------------------------------------------------------------------------"
    echo ">>> sweep complete"
    break
  fi
done < <(A logcat -T 1 ReactNativeJS:I '*:S' --format=raw 2>/dev/null)

A shell svc power stayon false >/dev/null 2>&1
echo ">>> rows saved to $ROWS"
