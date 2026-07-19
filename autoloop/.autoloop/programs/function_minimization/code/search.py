"""Search strategy. THIS is the file Autoloop optimizes.

Improve `search()` so it finds a lower objective value within the given budget.
A deliberately weak baseline (pure random search) is provided.
"""

import random


def search(objective, budget, seed):
    """Return the best (lowest) objective value found within `budget` evals.

    Args:
        objective: callable taking a length-DIM list, returning a float.
        budget: max number of objective evaluations.
        seed: RNG seed for reproducibility.

    Returns:
        best_value (float)
    """
    rng = random.Random(seed)
    lo, hi, dim = objective.LOWER, objective.UPPER, objective.DIM

    best = float("inf")
    for _ in range(budget):
        x = [rng.uniform(lo, hi) for _ in range(dim)]
        v = objective(x)
        if v < best:
            best = v
    return best
