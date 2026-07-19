"""Evaluator. DO NOT edit — this defines how candidates are scored."""

import json

from objective import Objective
from search import search

BUDGET = 2000
SEED = 12345


def main():
    obj = Objective(BUDGET)
    try:
        best = search(obj, BUDGET, SEED)
        valid = True
    except Exception as exc:  # noqa: BLE001
        best = float("inf")
        valid = False
        _ = exc

    result = {
        "score": -best if best != float("inf") else -1e18,
        "valid": bool(valid),
        "metrics": {"best": best, "evals": obj.evals},
    }
    print(json.dumps(result))


if __name__ == "__main__":
    main()
