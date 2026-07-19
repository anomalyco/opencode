"""Denoising filter. THIS is the file Autoloop optimizes.

Baseline: a short moving-average (box) filter. Improve `apply_filter` to raise
the signal-to-noise ratio of the reconstruction (e.g. wider/weighted windows,
Savitzky-Golay smoothing, low-pass FIR design, median hybrids).

Constraints:
- Return a list/array the SAME length as the input.
- Pure Python + the standard library only (no numpy/scipy import here unless
  you add it; the evaluator only relies on stdlib).
"""


def apply_filter(samples):
    """Return a denoised copy of `samples` (same length)."""
    n = len(samples)
    window = 3
    half = window // 2
    out = [0.0] * n
    for i in range(n):
        lo = max(0, i - half)
        hi = min(n, i + half + 1)
        chunk = samples[lo:hi]
        out[i] = sum(chunk) / len(chunk)
    return out
