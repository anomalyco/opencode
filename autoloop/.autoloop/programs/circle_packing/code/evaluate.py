"""Evaluator. DO NOT edit — defines scoring."""

import json
import math

from pack import pack

N = 26
EPS = 1e-9


def validate(circles):
    if len(circles) != N:
        return False, 0.0
    min_gap = float("inf")
    for (x, y, r) in circles:
        if r <= 0:
            return False, 0.0
        if x < r - EPS or x > 1 - r + EPS or y < r - EPS or y > 1 - r + EPS:
            return False, 0.0
    for i in range(N):
        xi, yi, ri = circles[i]
        for j in range(i + 1, N):
            xj, yj, rj = circles[j]
            d = math.hypot(xi - xj, yi - yj)
            gap = d - (ri + rj)
            if gap < min_gap:
                min_gap = gap
            if gap < -1e-6:
                return False, 0.0
    return True, min_gap


def main():
    try:
        circles = [tuple(map(float, c)) for c in pack(N)]
        valid, min_gap = validate(circles)
    except Exception:  # noqa: BLE001
        valid, min_gap, circles = False, 0.0, []

    if not valid:
        print(json.dumps({"score": 0.0, "valid": False, "metrics": {}}))
        return

    total = sum(c[2] for c in circles)
    print(json.dumps({
        "score": total,
        "valid": True,
        "metrics": {"sum_radii": total, "min_gap": min_gap},
    }))


if __name__ == "__main__":
    main()
