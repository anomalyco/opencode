"""Evaluator. DO NOT edit — defines scoring."""

import json
import math
import random

from filter import apply_filter

N = 512
SEED = 2024
NOISE_STD = 0.5


def make_signals():
    rng = random.Random(SEED)
    clean = []
    for i in range(N):
        t = i / N
        clean.append(math.sin(2 * math.pi * 5 * t) + 0.5 * math.sin(2 * math.pi * 12 * t))
    noisy = [c + rng.gauss(0.0, NOISE_STD) for c in clean]
    return clean, noisy


def snr_db(clean, recon):
    sig_power = sum(c * c for c in clean) / len(clean)
    err_power = sum((c - r) ** 2 for c, r in zip(clean, recon)) / len(clean)
    if err_power <= 0:
        return 120.0
    return 10.0 * math.log10(sig_power / err_power)


def main():
    clean, noisy = make_signals()
    try:
        recon = list(apply_filter(noisy))
        valid = len(recon) == len(noisy)
    except Exception:  # noqa: BLE001
        recon, valid = [], False

    if not valid:
        print(json.dumps({"score": -120.0, "valid": False, "metrics": {}}))
        return

    s = snr_db(clean, recon)
    print(json.dumps({"score": s, "valid": True, "metrics": {"snr_db": s}}))


if __name__ == "__main__":
    main()
