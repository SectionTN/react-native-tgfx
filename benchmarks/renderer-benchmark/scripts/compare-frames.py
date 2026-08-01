#!/usr/bin/env python3
"""Numeric comparison of two frozen-frame captures.

Two modes:

  identical  a refactor of the transport must not change a single pixel, so any
             differing pixel fails.
  parity     different rasterizers never agree on anti-aliased edge coverage, so
             report interior (non-edge) differences separately: those are real
             rendering errors. Geometry invariants (content bbox, centroid,
             filled area) catch an offset or scale error that a small pixel
             count would hide.

Usage: compare-frames.py <a.png> <b.png> [--mode=identical|parity]
"""
import sys

import numpy as np
from PIL import Image

TOL = 8  # per-channel 0-255 difference that counts as "different"


def load(path):
    return np.asarray(Image.open(path).convert('RGB')).astype(np.int16)


def content_mask(a):
    return a.max(axis=2) > 12


def bbox(mask):
    rows = np.flatnonzero(mask.any(axis=1))
    cols = np.flatnonzero(mask.any(axis=0))
    if rows.size == 0 or cols.size == 0:
        return None
    return int(rows[0]), int(rows[-1]), int(cols[0]), int(cols[-1])


def centroid(mask):
    ys, xs = np.nonzero(mask)
    if ys.size == 0:
        return None
    return float(ys.mean()), float(xs.mean())


def main():
    paths = [a for a in sys.argv[1:] if not a.startswith('--')]
    mode = next(
        (a.split('=')[1] for a in sys.argv[1:] if a.startswith('--mode=')), 'identical'
    )
    a, b = load(paths[0]), load(paths[1])
    if a.shape != b.shape:
        print(f'FAIL shape {a.shape} != {b.shape}')
        return 1

    diff = np.abs(a - b).max(axis=2)
    differing = diff > TOL
    total = diff.size
    exact = int((diff > 0).sum())
    print(f'pixels          {total}')
    print(f'differing >0    {exact} ({100 * exact / total:.4f}%)')
    print(f'differing >{TOL}    {int(differing.sum())} '
          f'({100 * differing.sum() / total:.4f}%)')
    print(f'max channel     {int(diff.max())}')

    maskA, maskB = content_mask(a), content_mask(b)
    for name, mask in (('a', maskA), ('b', maskB)):
        box, cen = bbox(mask), centroid(mask)
        print(f'{name}: bbox={box} centroid={None if cen is None else (round(cen[0], 2), round(cen[1], 2))} '
              f'area={int(mask.sum())}')

    if mode == 'identical':
        ok = exact == 0
        print('IDENTICAL' if ok else 'NOT IDENTICAL')
        return 0 if ok else 1

    # parity: an "edge" pixel is one adjacent to a content boundary in either
    # image, where anti-aliasing legitimately differs between rasterizers.
    edge = np.zeros_like(maskA)
    for mask in (maskA, maskB):
        for shift in (1, -1):
            edge |= mask ^ np.roll(mask, shift, axis=0)
            edge |= mask ^ np.roll(mask, shift, axis=1)
    interior = differing & ~edge
    print(f'interior diff   {int(interior.sum())} '
          f'({100 * interior.sum() / total:.4f}%)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
