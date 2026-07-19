"""Circle packing construction. THIS is the file Autoloop optimizes.

Baseline: a uniform grid of equal circles. Improve `pack(n)` to increase the
sum of radii (variable radii, relaxation/nudging, hexagonal layouts, etc.).

Return a list of (x, y, r) tuples describing a VALID packing in [0, 1]^2.
Pure Python standard library only.
"""

import math


def pack(n):
    """Return a list of n (x, y, r) circles packed in the unit square."""
    cols = int(math.ceil(math.sqrt(n)))
    rows = int(math.ceil(n / cols))
    r = 0.5 / max(cols, rows)

    circles = []
    idx = 0
    for row in range(rows):
        for col in range(cols):
            if idx >= n:
                break
            x = (col + 0.5) / cols
            y = (row + 0.5) / rows
            circles.append((x, y, r))
            idx += 1
    return circles
