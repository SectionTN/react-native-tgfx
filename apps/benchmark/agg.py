#!/usr/bin/env python3
"""Aggregate bench.sh rows.

A metric only counts as a win when the two engines' run ranges do not overlap
(tgfx min beats skia max, or vice versa) — a 3-run median swing is not a win.
Metrics pinned within 2% of the observed refresh ceiling are reported as capped
and decided on frame-time percentiles instead, which have no ceiling.
"""
import statistics
import sys
from collections import defaultdict

COLS = ["lib", "wl", "n", "run", "uiFps", "jsFps", "prsFps", "jank", "f90", "f95",
        "uiJank", "uiMaxMs", "cpu", "pss", "mainCpu", "jsCpu", "rtCpu", "gfxCpu", "deg"]
NUM = ["uiFps", "jsFps", "prsFps", "jank", "f90", "f95", "uiJank", "uiMaxMs",
       "cpu", "pss", "mainCpu", "jsCpu", "rtCpu", "gfxCpu", "deg"]
HIGHER = {"uiFps", "jsFps", "prsFps"}
# One verdict per independent axis. cpu is the SUM that already contains mainCpu
# and jsCpu, so counting all three would count one improvement three times; total
# cpu is the honest cost metric now that tgfx renders on a second thread.
VERDICT = ["prsFps", "uiFps", "f95", "cpu", "pss"]


def parse(path):
    groups = defaultdict(lambda: defaultdict(list))
    baseline = None
    with open(path) as fh:
        for line in fh:
            if line.startswith("#baselinePss"):
                try:
                    baseline = float(line.split("\t")[1])
                except (IndexError, ValueError):
                    pass
                continue
            parts = line.rstrip("\n").split("\t")
            if len(parts) < len(COLS):
                continue
            row = dict(zip(COLS, parts))
            key = (row["wl"], int(row["n"]), row["lib"])
            for c in NUM:
                try:
                    groups[key][c].append(float(row[c]))
                except ValueError:
                    pass
    return groups, baseline


def main(path):
    groups, baseline = parse(path)
    ceiling = max((max(v["uiFps"]) for v in groups.values() if v["uiFps"]), default=0.0)

    configs = sorted({(wl, n) for (wl, n, _) in groups})
    print()
    if baseline is not None:
        print(f"idle baseline PSS (both libs loaded, nothing mounted): {baseline:.1f} MB")
    print(f"observed refresh ceiling: {ceiling:.1f} fps")
    hdr = (f"{'wl':<7} {'N':>5} {'lib':<5} {'runs':>4} {'uiFps':>15} {'jsFps':>15} "
           f"{'prsFps':>15} {'f95':>5} {'mainC%':>7} {'gfxC%':>6} {'cpu%':>15} {'pssMB':>7} {'degC':>5}")
    print()
    print(hdr)
    print("-" * len(hdr))

    summary = []
    for wl, n in configs:
        stats = {}
        for lib in ("tgfx", "skia"):
            g = groups.get((wl, n, lib))
            if not g:
                continue
            s = {c: (statistics.median(g[c]), min(g[c]), max(g[c])) for c in NUM if g[c]}
            stats[lib] = s
            runs = len(g["uiFps"])
            def rng(c):
                if c not in s:
                    return f"{'NA':>15}"
                m, lo, hi = s[c]
                return f"{m:>7.1f}[{lo:.0f}-{hi:.0f}]".rjust(15)
            def med(c):
                return s[c][0] if c in s else float("nan")
            print(f"{wl:<7} {n:>5} {lib:<5} {runs:>4} {rng('uiFps')} {rng('jsFps')} "
                  f"{rng('prsFps')} {med('f95'):>5.0f} {med('mainCpu'):>7.1f} "
                  f"{med('gfxCpu'):>6.1f} {rng('cpu')} {med('pss'):>7.1f} {med('deg'):>5.1f}")

        if "tgfx" not in stats or "skia" not in stats:
            print()
            continue

        t, s_ = stats["tgfx"], stats["skia"]
        # A canvas that never presented is a broken run, not a fast one.
        for lib, st in (("tgfx", t), ("skia", s_)):
            if wl != "idle" and st.get("prsFps", (0,))[0] < 1.0:
                print(f"{'':<7} {'':>5} !! {lib} presented < 1 fps — treat this row as FAILED")

        verdicts = {}
        lines = []
        for c in VERDICT:
            if c not in t or c not in s_:
                continue
            tm, tlo, thi = t[c]
            sm, slo, shi = s_[c]
            capped = c in HIGHER and ceiling > 0 and tm >= ceiling * 0.98 and sm >= ceiling * 0.98
            pct = ((tm - sm) / sm * 100) if sm else float("nan")
            if capped:
                verdicts[c] = "capped"
                lines.append(f"{c} capped(both ~{ceiling:.0f})")
                continue
            better_hi = c in HIGHER
            if (tlo > shi) if better_hi else (thi < slo):
                verdicts[c] = "win"
                lines.append(f"{c} {pct:+.1f}% WIN")
            elif (thi < slo) if better_hi else (tlo > shi):
                verdicts[c] = "loss"
                lines.append(f"{c} {pct:+.1f}% LOSS")
            else:
                verdicts[c] = "tie"
                lines.append(f"{c} {pct:+.1f}% tie")
        print(f"{'':<7} {'':>5} {'Δ':<5} " + "  ".join(lines))
        summary.append((wl, n, verdicts))
        print()

    print("=" * 78)
    print("verdict per config (ranges must not overlap to count as win/loss)")
    for wl, n, v in summary:
        losses = [c for c, r in v.items() if r == "loss"]
        wins = [c for c, r in v.items() if r == "win"]
        state = "LOSES" if losses else ("wins" if wins else "tie")
        print(f"  {wl:<7} N={n:<5} {state:<6} wins={wins or '-'} losses={losses or '-'}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "/tmp/tgfx_rows.tsv")
