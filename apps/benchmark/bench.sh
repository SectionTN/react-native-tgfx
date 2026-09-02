#!/usr/bin/env bash
# tgfx vs Skia perf harness (Android, physical device).
#
# In-process the app reports UI-thread FPS and JS-thread FPS with identical
# instrumentation for both engines. This script adds the out-of-process numbers:
# presented frames (gfxinfo), jank%, frame-time percentiles, per-thread CPU,
# whole-process CPU, and memory.
#
# Per-thread CPU is DIAGNOSTIC ONLY: 12-28% of process CPU lives on unnamed
# driver threads, and Skia rasterizes on the main thread while tgfx uses its own,
# so the buckets are not comparable. procCpu is the comparable number.
#
# Usage: bash bench.sh [--skip-build] [serial]
set -uo pipefail

PKG=com.tgfxbench
APK=android/app/build/outputs/apk/release/app-release.apk
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

SKIP_BUILD=""
DEV=""
for a in "$@"; do
  case "$a" in
    --skip-build) SKIP_BUILD=1 ;;
    *) DEV="$a" ;;
  esac
done
[ -z "$DEV" ] && DEV="$(adb devices | awk 'NR==2{print $1}')"
[ -z "$DEV" ] && { echo "ERR: no device" >&2; exit 1; }

A() { adb -s "$DEV" "$@"; }
CHAR=$(A shell getprop ro.build.characteristics | tr -d '\r')
case "$CHAR" in *emulator*) echo "ERR: $DEV is an emulator — GPU numbers are meaningless" >&2; exit 1 ;; esac
CLK=$(A shell getconf CLK_TCK 2>/dev/null | tr -d '\r'); CLK=${CLK:-100}
echo ">>> device=$DEV abi=$(A shell getprop ro.product.cpu.abi | tr -d '\r') CLK_TCK=$CLK char=$CHAR"

if [ -z "$SKIP_BUILD" ]; then
  echo ">>> building release APK (arm64-v8a)..."
  (cd android && ./gradlew assembleRelease --no-daemon -PreactNativeArchitectures=arm64-v8a -q) \
    || { echo "ERR: gradle build failed" >&2; exit 1; }
  echo ">>> installing..."
  A install -r "$APK" 2>&1 | tail -1
fi

A shell svc power stayon true >/dev/null 2>&1
A shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1
# Pin the panel at its native 90 Hz so nothing is measured against a 60 Hz cap.
A shell settings put system min_refresh_rate 90 >/dev/null 2>&1
A shell settings put system peak_refresh_rate 90 >/dev/null 2>&1
echo ">>> refresh: $(A shell dumpsys display 2>/dev/null | grep -oE 'renderFrameRate [0-9.]+' | head -1)"

TMPLOG=$(mktemp /tmp/tgfxbench_XXXXXX.log)
MARKSEEN=$(mktemp /tmp/tgfxseen_XXXXXX)
MARKNEW=$(mktemp /tmp/tgfxnew_XXXXXX)
PSSTMP=$(mktemp /tmp/tgfxpss_XXXXXX)
ROWS="${ROWS:-/tmp/tgfx_rows.tsv}"
: > "$ROWS"
A logcat -c 2>/dev/null
# No persistent logcat stream: it silently dies under adb churn and drops rows.
# Snapshot-poll with timestamped dedup instead; any one poll failing is harmless.
cleanup() { rm -f "$TMPLOG" "$PSSTMP" "$MARKSEEN" "$MARKNEW"; A shell svc power stayon false >/dev/null 2>&1; }
trap cleanup EXIT

echo ">>> cold-launching $PKG (mode=bench)..."
A shell am force-stop "$PKG" >/dev/null 2>&1
sleep 0.5
A shell am start -n "$PKG/.MainActivity" -e mode bench ${PLAN:+-e plan $PLAN} ${LIBS:+-e libs $LIBS} ${WL:+-e wl $WL} ${N:+-e n $N} ${WINDOW:+-e window $WINDOW} >/dev/null 2>&1
sleep 3
A shell dumpsys activity activities 2>/dev/null | grep -q "topResumedActivity.*$PKG" || {
  echo ">>> app not foregrounded, retrying via launcher intent"
  A shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
}

PID=""
for _ in $(seq 1 90); do
  PID=$(A shell pidof "$PKG" | tr -d '\r' | awk '{print $1}')
  [ -n "$PID" ] && break
  sleep 1
done
[ -z "$PID" ] && { echo "ERR: app never started" >&2; exit 1; }

cpu_jiffies() { A shell cat /proc/"$PID"/stat 2>/dev/null | awk '{print $14+$15}'; }
find_tid() {
  A shell ps -T -p "$PID" -o TID,CMD 2>/dev/null | tr -d '\r' \
    | awk -v n="$1" '$2 == n { print $1 }' | tr '\n' ' '
}
tid_jiffies() {
  local sum=0 v
  for t in ${1:-}; do
    v=$(A shell cat /proc/"$PID"/task/"$t"/stat 2>/dev/null | awk '{print $14+$15}')
    sum=$((sum + ${v:-0}))
  done
  [ -z "${1:-}" ] && return
  echo "$sum"
}
pss_mb() {
  local raw
  raw=$(A shell dumpsys meminfo "$PKG" 2>/dev/null | grep 'TOTAL PSS:' | head -1 | grep -oE '[0-9]+' | head -1)
  [ -z "$raw" ] && { echo NA; return; }
  python3 -c "print(round($raw/1024,1))"
}
graphics_kb() {
  local raw
  raw=$(A shell dumpsys meminfo "$PKG" 2>/dev/null | awk '/^ *Graphics:/{print $2; exit}')
  [ -z "$raw" ] && { echo NA; return; }
  echo "$raw"
}
temp_c() {
  A shell dumpsys battery 2>/dev/null | sed -n 's/.*temperature: \([0-9]*\).*/\1/p' | head -1 \
    | tr -d '\r' | awk 'NF { printf "%.1f", $1/10 }'
}
# Mali busy % and clock, sampled twice a second while a window is measuring.
GPU_UTIL_PATH=/sys/kernel/gpu/gpu_busy
GPU_CLK_PATH=/sys/kernel/gpu/gpu_clock
GPUTMP=$(mktemp /tmp/tgfxgpu_XXXXXX)
gpu_sampler() {
  while :; do
    A shell "echo \$(cat $GPU_UTIL_PATH 2>/dev/null) \$(cat $GPU_CLK_PATH 2>/dev/null)" \
      | tr -d '\r%' >> "$GPUTMP" 2>/dev/null
    sleep 0.5
  done
}
gpu_mean() { awk -v c="$1" 'NF>=c && $c+0==$c {s+=$c;n++} END{if(n)printf "%.0f",s/n; else print "NA"}' "$GPUTMP"; }
sf_layer() {
  A shell dumpsys SurfaceFlinger --list 2>/dev/null | tr -d '\r' \
    | grep -E "SurfaceView\[$PKG" | head -1
}
# Android 15's legacy --latency tracker returns no rows; timestats still works.
# Busiest app layer wins: the SurfaceView when it has frames (tgfx/thor), else
# the activity window (Skia renders through HWUI).
sf_prs() {
  A shell 'dumpsys SurfaceFlinger --timestats -dump' 2>/dev/null | tr -d '\r' | awk -v pkg="$PKG" '
    /^layerName = /  { keep = (index($0, pkg) > 0); sv = (index($0, "SurfaceView[") > 0) }
    keep && /totalFrames = / { tf = $3 }
    keep && /averageFPS = /  { if (sv) { if (tf > bestSvTf) { bestSvTf = tf; bestSv = $3 } }
                               else    { if (tf > bestTf)   { bestTf = tf;   best = $3 } } }
    END { if (bestSvTf > 30) print bestSv; else if (bestTf > 0) print best; else print "NA" }'
}
# Present rate from a SurfaceFlinger layer's actualPresentTime deltas. The
# tracker keeps only the last ~128 frames, so this is a rate, not a total.
sf_fps() {
  [ -z "${1:-}" ] && { echo NA; return; }
  A shell dumpsys SurfaceFlinger --latency "'$1'" 2>/dev/null | tr -d '\r' \
    | awk 'NR>1 && $2+0>0 {t[n++]=$2}
           END { if (n<8) { print "NA"; exit }
                 d=(t[n-1]-t[0])/1e9; if (d<=0) { print "NA"; exit }
                 printf "%.2f", (n-1)/d }'
}
# Vsync period actually in force; the jank deadline is 2x this and the panel
# switches modes mid-window. AOSP emits cols 11/12 swapped, so range-check.
frame_interval_ms() {
  A shell dumpsys gfxinfo "$PKG" framestats 2>/dev/null | tr -d '\r' \
    | awk -F, '/^0,/ && $12+0>5000000 && $12+0<40000000 {s+=$12; n++}
               END { if (n) printf "%.2f", s/n/1e6; else printf "NA" }'
}
gfx_num() { echo "$1" | sed -n "s/.*$2: \([0-9]*\).*/\1/p" | head -1; }
pct_ms()  { echo "$1" | sed -n "s/.*$2 percentile: \([0-9]*\)ms.*/\1/p" | head -1; }
field()   { echo "$1" | sed -n "s/.*[[:space:]]$2=\([^ ]*\).*/\1/p" | head -1; }
na()      { [ -z "${1:-}" ] && echo NA || echo "$1"; }

JSTID=$(find_tid mqt_v_js)
RTTID=$(find_tid RenderThread)
GTTID=$(find_tid TgfxRender)
echo ">>> pid=$PID  jsTid=$JSTID  hwuiRenderTid=$RTTID  tgfxRenderTid=$GTTID"

printf "\n%-5s %-7s %5s %4s %7s %7s %7s %6s %5s %6s %6s %6s %6s %6s %7s %7s %5s %5s %6s\n" \
  lib wl N run uiFps jsFps prsFps jank% f95 mainC jsC gfxC rtC cpu% pssMB gfxdMB degC gpu% gpuMHz
echo "----------------------------------------------------------------------------------------------------------"

t0=""; c0=""; BASEPSS=NA; FLOOR=NA
SWEEP_DONE=0
handle_line() {
  local line="$1"
  case "$line" in
    *BENCH_BASELINE*)
      sleep 3
      BASEPSS=$(pss_mb)
      echo ">>> idle baseline PSS = ${BASEPSS} MB (both libs loaded, nothing mounted)"
      echo "#baselinePss	$BASEPSS" >> "$ROWS"
      ;;
    *BENCH_IDLE*)
      FLOOR=$(graphics_kb)
      ;;
    *BENCH_START*)
      JSTID=$(find_tid mqt_v_js); RTTID=$(find_tid RenderThread)
      GTTID=$(find_tid TgfxRender)
      A shell dumpsys gfxinfo "$PKG" reset >/dev/null 2>&1
      A shell 'dumpsys SurfaceFlinger --timestats -clear -enable' >/dev/null 2>&1
      : > "$GPUTMP"
      gpu_sampler & GPUPID=$!
      t0=$(python3 -c 'import time;print(time.time())')
      c0=$(cpu_jiffies)
      m0=$(tid_jiffies "$PID"); j0=$(tid_jiffies "$JSTID"); r0=$(tid_jiffies "$RTTID")
      g0=$(tid_jiffies "$GTTID")
      # Sample PSS mid-window, while the scene is still mounted and animating.
      : > "$PSSTMP"
      ( for _ in 1 2 3; do sleep 1.5; echo "$(pss_mb) $(graphics_kb)"; done \
          | sort -rn | head -1 > "$PSSTMP" ) &
      PSSPID=$!
      ;;
    *BENCH_END*)
      [ -z "$t0" ] && return 0
      [ -n "${GPUPID:-}" ] && { kill "$GPUPID" 2>/dev/null; wait "$GPUPID" 2>/dev/null; GPUPID=""; }
      gpuB=$(gpu_mean 1); gpuM=$(gpu_mean 2)
      t1=$(python3 -c 'import time;print(time.time())')
      gfx=$(A shell dumpsys gfxinfo "$PKG" 2>/dev/null)
      c1=$(cpu_jiffies)
      m1=$(tid_jiffies "$PID"); j1=$(tid_jiffies "$JSTID"); r1=$(tid_jiffies "$RTTID")
      g1=$(tid_jiffies "$GTTID")
      [ -n "${PSSPID:-}" ] && wait "$PSSPID" 2>/dev/null
      PSSPID=""
      samp=$(cat "$PSSTMP" 2>/dev/null)
      NEWPID=$(A shell pidof "$PKG" | tr -d '\r' | awk '{print $1}')
      if [ "$NEWPID" != "$PID" ]; then
        echo "!!! pid changed ($PID -> $NEWPID): app restarted, aborting" >&2
        SWEEP_DONE=1
        return 0
      fi
      pss=$(na "$(echo "$samp" | awk '{print $1}')")
      gfxkb=$(na "$(echo "$samp" | awk '{print $2}')")
      if [ "$gfxkb" != "NA" ] && [ "$FLOOR" != "NA" ]; then
        gfxd=$(python3 -c "print(round(($gfxkb-$FLOOR)/1024,1))")
      else
        gfxd=NA
      fi
      deg=$(temp_c); deg=$(na "$deg")
      fint=$(na "$(frame_interval_ms)")
      lib=$(field "$line" lib); wl=$(field "$line" wl)
      n=$(field "$line" n); run=$(field "$line" run)
      uiFps=$(field "$line" uiFps); jsFps=$(field "$line" jsFps)
      uiJank=$(field "$line" uiJank); uiMaxMs=$(field "$line" uiMaxMs)
      frames=$(gfx_num "$gfx" "Total frames rendered")
      janky=$(echo "$gfx" | grep -oE 'Janky frames: [0-9]+ \([0-9.]+%\)' | head -1 | grep -oE '[0-9.]+%' | tr -d '%')
      f90=$(pct_ms "$gfx" "90th"); f95=$(pct_ms "$gfx" "95th")
      dur=$(python3 -c "print($t1-$t0)")
      prs=$(sf_prs)
      prssrc=timestats
      if [ "$prs" = "NA" ] && [ -n "$frames" ]; then
        prs=$(python3 -c "print(round($frames/$dur,2))")
        prssrc=hwui
      fi
      pct() { if [ -z "${1:-}" ] || [ -z "${2:-}" ]; then echo NA; else python3 -c "print(round(($2-$1)/$CLK/$dur*100,1))"; fi; }
      cpu=$(pct "$c0" "$c1")
      mainCpu=$(pct "$m0" "$m1"); jsCpu=$(pct "$j0" "$j1"); rtCpu=$(pct "$r0" "$r1")
      gfxCpu=$(pct "$g0" "$g1")
      printf "%-5s %-7s %5s %4s %7s %7s %7s %6s %5s %6s %6s %6s %6s %6s %7s %7s %5s %5s %6s\n" \
        "$lib" "$wl" "$n" "$run" "$uiFps" "$jsFps" "$prs" "$(na "$janky")" "$(na "$f95")" \
        "$mainCpu" "$jsCpu" "$gfxCpu" "$rtCpu" "$cpu" "$pss" "$gfxd" "$deg" "$gpuB" "$gpuM"
      printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n" \
        "$lib" "$wl" "$n" "$run" "$uiFps" "$jsFps" "$prs" "$(na "$janky")" "$(na "$f90")" \
        "$(na "$f95")" "$uiJank" "$uiMaxMs" "$cpu" "$pss" "$mainCpu" "$jsCpu" "$rtCpu" \
        "$gfxCpu" "$deg" "$gfxd" "$fint" "$prssrc" "$gpuB" "$gpuM" >> "$ROWS"
      t0=""
      ;;
    *BENCH_SWEEP_DONE*)
      echo "----------------------------------------------------------------------------------------------------------"
      SWEEP_DONE=1
      ;;
  esac
}

DEADLINE=$(( $(date +%s) + 3600 ))
while [ "$SWEEP_DONE" = 0 ] && [ "$(date +%s)" -lt "$DEADLINE" ]; do
  A logcat -d -t 800 -v time -s ReactNativeJS 2>/dev/null | tr -d '\r' | grep -F 'BENCH_' > "$MARKNEW" || true
  while IFS= read -r line; do
    grep -qxF -- "$line" "$MARKSEEN" 2>/dev/null && continue
    printf '%s\n' "$line" >> "$MARKSEEN"
    handle_line "$line"
    [ "$SWEEP_DONE" = 1 ] && break
  done < "$MARKNEW"
  sleep 2
done

echo ">>> raw rows: $ROWS"
python3 "$HERE/agg.py" "$ROWS"
