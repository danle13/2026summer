#!/usr/bin/env python3
"""
Step 1 of the stock-face build: chop the SFHQ-T2I contact sheets into individual
face images.

The sheets are grids of images on a black background with a white caption above
each cell, so the cells fall out of the image by finding the rows and columns
that are essentially pure black.

Usage:  python3 slice_montages.py <montage-dir> <out-dir>
"""
import sys, pathlib
import numpy as np
from PIL import Image

# A gutter row/column is one where almost every pixel is near-black. Captions are
# white-on-black text, so they are *mostly* black — hence the tight threshold on
# the fraction of lit pixels rather than on the mean.
DARK_LEVEL = 26
MAX_LIT_FRACTION = 0.02
MIN_CELL = 220


def runs_of_content(mask):
    """Yield (start, end) spans of consecutive False (= content) entries."""
    spans, start = [], None
    for i, is_gutter in enumerate(mask):
        if not is_gutter and start is None:
            start = i
        elif is_gutter and start is not None:
            spans.append((start, i))
            start = None
    if start is not None:
        spans.append((start, len(mask)))
    return spans


def slice_sheet(path, out_dir, stem):
    image = Image.open(path).convert('RGB')
    pixels = np.asarray(image)
    lit = (pixels.max(axis=2) > DARK_LEVEL)

    row_gutter = lit.mean(axis=1) < MAX_LIT_FRACTION
    col_gutter = lit.mean(axis=0) < MAX_LIT_FRACTION

    rows = [s for s in runs_of_content(row_gutter) if s[1] - s[0] >= MIN_CELL]
    cols = [s for s in runs_of_content(col_gutter) if s[1] - s[0] >= MIN_CELL]

    written = 0
    for r, (y0, y1) in enumerate(rows):
        for c, (x0, x1) in enumerate(cols):
            cell = image.crop((x0, y0, x1, y1))
            if min(cell.size) < MIN_CELL:
                continue
            cell.save(out_dir / f'{stem}_r{r:02d}c{c:02d}.png')
            written += 1
    print(f'{path.name}: {len(rows)} rows x {len(cols)} cols -> {written} cells '
          f'(cell ~{rows[0][1]-rows[0][0] if rows else 0}x{cols[0][1]-cols[0][0] if cols else 0})')
    return written


def main():
    src = pathlib.Path(sys.argv[1])
    out = pathlib.Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    total = 0
    for sheet in sorted(src.glob('g_*.jpg')):
        total += slice_sheet(sheet, out, sheet.stem[2:])
    print('total cells:', total)


if __name__ == '__main__':
    main()
