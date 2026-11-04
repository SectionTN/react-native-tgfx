#!/bin/bash
# Retries a failed Harness run, up to HARNESS_RETRIES times (default 3). Each
# retry runs only the files the previous run's Jest report marks failed; with no
# report (the run died before writing one, e.g. the simulator never booted) it
# runs the whole suite again.
#
#   cd apps/example
#   bunx react-native-harness --harnessRunner <runner> --json --outputFile=<report.json>
#   bash ../../scripts/harness-retry.sh <runner> <report.json>
#
# The harness-{ios,android}.yml workflows run this after the first run fails,
# with HARNESS_APP_PATH set as the Harness action sets it.
set -euo pipefail

RUNNER="$1"
REPORT="$2"
RETRIES="${HARNESS_RETRIES:-3}"
# A runner without committed baselines (gitignored, see rn-harness.config.mjs)
# writes them fresh, so what the failed run wrote would become the retry's
# reference. Each retry starts without them, and they are merged back after it
# for the snapshot upload.
SNAPSHOTS="src/__image_snapshots__/$RUNNER"

for attempt in $(seq 1 "$RETRIES"); do
  failed=()
  if [ -s "$REPORT" ]; then
    while IFS= read -r file; do failed+=("$file"); done \
      < <(jq -r '.testResults[] | select(.status == "failed") | .name' "$REPORT" 2>/dev/null || true)
  fi
  # A run that dies early must not leave the last run's report behind.
  rm -f "$REPORT"

  args=(--harnessRunner "$RUNNER" --json "--outputFile=$REPORT")
  if [ ${#failed[@]} -gt 0 ]; then
    echo ">>> retry $attempt/$RETRIES: ${#failed[@]} failed file(s)"
    printf '    %s\n' "${failed[@]}"
    args+=(--runTestsByPath "${failed[@]}")
  else
    echo ">>> retry $attempt/$RETRIES: no failed files in the last report, running the whole suite"
  fi

  kept=""
  if [ -d "$SNAPSHOTS" ] && git check-ignore -q "$SNAPSHOTS"; then
    kept="$(mktemp -d)"
    mv "$SNAPSHOTS" "$kept/snapshots"
  fi

  passed=0
  if bunx react-native-harness "${args[@]}"; then passed=1; fi

  if [ -n "$kept" ]; then
    # The retry's images win over the failed run's.
    if [ -d "$SNAPSHOTS" ]; then cp -R "$SNAPSHOTS/." "$kept/snapshots/"; fi
    rm -rf "$SNAPSHOTS"
    mv "$kept/snapshots" "$SNAPSHOTS"
    rm -rf "$kept"
  fi

  if [ "$passed" = 1 ]; then
    echo ">>> passed on retry $attempt/$RETRIES"
    exit 0
  fi
done

echo ">>> still failing after $RETRIES retries" >&2
exit 1
