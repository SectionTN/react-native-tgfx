#!/usr/bin/env python3
"""Compare the tgfx and Skia crops of each parity screenshot.

Two independent rasterizers never agree bit-for-bit on anti-aliased edge
coverage, so a single flat "% pixels differing" number is not a usable gate: it
is dominated by AA noise and says nothing about correctness. This splits the
comparison instead:

  interior% — pixels differing by >TOL that are NOT within 1 px of an edge.
              Any non-zero value here is a real rendering error (wrong colour,
              wrong fill, wrong shape). Gate: must be 0.
  edge%     — differing pixels that sit on an anti-aliased boundary. Reported,
              and bounded loosely so a gross geometry error still trips it.
  bbox/centroid/area — geometry invariants that catch an offset or scale error
              even when the pixel diff looks small.

A blank crop fails loudly instead of silently passing.
"""
import glob
import os
import re
import sys
from collections import defaultdict

import numpy as np
from PIL import Image

TOL = 8              # per-channel 0-255 difference that counts as "different"
INTERIOR_GATE = 0.0  # % of non-edge pixels allowed to differ
EDGE_GATE = 3.0      # % of all pixels allowed to differ on AA edges
BBOX_GATE = 1        # px of allowed content bounding-box drift
AREA_GATE = 0.5      # % of allowed filled-area difference


def content_mask(a):
    return a.max(axis=2) > 12


def bbox(mask):
    if not mask.any():
        return None
    ys, xs = np.where(mask)
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def edge_mask(img):
    """Pixels on or adjacent to a luminance edge — i.e. where AA lives."""
    gray = img.mean(axis=2)
    gx = np.abs(np.diff(gray, axis=1, prepend=gray[:, :1]))
    gy = np.abs(np.diff(gray, axis=0, prepend=gray[:1, :]))
    e = (gx + gy) > 10
    out = e.copy()
    for s in (1, -1):
        out |= np.roll(e, s, axis=0)
        out |= np.roll(e, s, axis=1)
    return out


def main(out_dir):
    layout_path = os.path.join(out_dir, "layout.txt")
    if not os.path.exists(layout_path):
        print("ERR: no layout.txt — the app never logged PARITY_LAYOUT")
        return 1
    g = {k: float(v) for k, v in re.findall(r"(\w+)=([0-9.]+)", open(layout_path).read())}
    x, w, h = int(g["x"]), int(g["w"]), int(g["h"])
    y_t, y_s = int(g["yTgfx"]), int(g["ySkia"])

    shots = sorted(glob.glob(os.path.join(out_dir, "r*_*.png")))
    if not shots:
        print("ERR: no screenshots captured")
        return 1

    worst = defaultdict(lambda: {"interior": 0.0, "edge": 0.0, "bbox": 0, "area": 0.0, "hard": []})
    rows = []
    for path in shots:
        base = os.path.basename(path)
        m = re.match(r"r(\d+)_([a-z]+)\.png", base)
        if not m:
            continue
        rnd, scene = int(m.group(1)), m.group(2)
        img = np.asarray(Image.open(path).convert("RGB")).astype(np.int16)
        if img.shape[0] < y_s + h or img.shape[1] < x + w:
            worst[scene]["hard"].append(f"r{rnd}: screenshot smaller than layout")
            continue
        # The canvases sit on a black root. If the margin beside them is not
        # black, something is covering the app (notification shade, dialog) and
        # the crops are not the scene at all.
        margin = img[y_t:y_s + h, 0:max(x - 2, 1)]
        if margin.size and margin.max() > 40:
            worst[scene]["hard"].append(f"r{rnd}: capture obscured (margin not black)")
            continue
        a = img[y_t:y_t + h, x:x + w]
        b = img[y_s:y_s + h, x:x + w]
        ma, mb = content_mask(a), content_mask(b)
        ba, bb = bbox(ma), bbox(mb)
        if ba is None or bb is None:
            which = "tgfx" if ba is None else "skia"
            worst[scene]["hard"].append(f"r{rnd}: {which} crop is blank")
            continue

        d = np.abs(a - b).max(axis=2)
        bad = d > TOL
        e = edge_mask(b) | edge_mask(a)
        interior = float((bad & ~e).mean() * 100)
        edge = float((bad & e).mean() * 100)
        drift = max(abs(p - q) for p, q in zip(ba, bb))
        # Total coverage, not a thresholded pixel count: a thresholded count is
        # sensitive to how soft each rasterizer's AA falloff is, which is exactly
        # the difference we are trying not to measure here.
        ca, cb = a.max(axis=2).sum(), b.max(axis=2).sum()
        area = float(abs(int(ca) - int(cb)) / max(int(cb), 1) * 100)

        wsc = worst[scene]
        wsc["interior"] = max(wsc["interior"], interior)
        wsc["edge"] = max(wsc["edge"], edge)
        wsc["bbox"] = max(wsc["bbox"], drift)
        wsc["area"] = max(wsc["area"], area)
        rows.append((scene, rnd, interior, edge, drift, area, int(d.max())))

    print(f"\ntolerance: per-channel diff > {TOL}/255 counts as differing")
    print(f"gates: interior <= {INTERIOR_GATE}%   edge <= {EDGE_GATE}%   "
          f"bbox drift <= {BBOX_GATE}px   area <= {AREA_GATE}%")
    print(f"crops: {w}x{h} px at x={x}, tgfx y={y_t}, skia y={y_s}\n")
    print(f"{'scene':<11} {'rnd':>3} {'interior%':>10} {'edge%':>8} {'bboxpx':>7} {'area%':>7} {'maxd':>5}")
    print("-" * 56)
    for scene, rnd, interior, edge, drift, area, maxd in rows:
        flag = "" if interior <= INTERIOR_GATE else "  <-- REAL DIFF"
        print(f"{scene:<11} {rnd:>3} {interior:>10.4f} {edge:>8.4f} {drift:>7} {area:>7.3f} {maxd:>5}{flag}")

    print("\nworst per scene across all rounds:")
    failed = []
    for scene in sorted(worst):
        v = worst[scene]
        ok = (not v["hard"] and v["interior"] <= INTERIOR_GATE and v["edge"] <= EDGE_GATE
              and v["bbox"] <= BBOX_GATE and v["area"] <= AREA_GATE)
        if not ok:
            failed.append(scene)
        note = ("; ".join(v["hard"]) if v["hard"] else "")
        print(f"  {scene:<11} interior={v['interior']:>7.4f}%  edge={v['edge']:>7.4f}%  "
              f"bbox={v['bbox']}px  area={v['area']:.3f}%  {'PASS' if ok else 'FAIL'} {note}")

    print("\nPARITY: " + ("PASS" if not failed else f"FAIL {failed}"))
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "/tmp/tgfx_parity"))
