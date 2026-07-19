# Program: circle_packing

## Goal

Pack `N = 26` non-overlapping circles into the unit square `[0, 1]^2` so as to
**maximize the sum of their radii**. This is a well-known geometric optimization
benchmark (used by AlphaEvolve). The construction lives in `code/pack.py` as
`pack(n)`, which returns a list of `(x, y, r)` tuples.

A trivial grid-of-equal-circles baseline is provided. The frontier is reached by
allowing variable radii and nudging circles apart.

## Target metric

`score = sum_of_radii` for a valid packing.

A packing is **valid** iff, for every circle:
- it lies fully inside the unit square: `r <= x <= 1 - r` and `r <= y <= 1 - r`
- it does not overlap any other circle: for all pairs,
  `dist(centers) >= r_i + r_j - 1e-9`
- `r > 0`

Invalid packings score `0` with `valid = false`.

**Target:** reach `sum_of_radii >= 2.6` (baseline is well below this).

## Evaluation contract

`code/evaluate.py` calls `pack(26)`, validates the geometry, and prints
`{"score": total_r, "valid": bool, "metrics": {"sum_radii": total_r, "min_gap": g}}`.
Do not change `evaluate.py` or `N` — only edit `pack.py`.
