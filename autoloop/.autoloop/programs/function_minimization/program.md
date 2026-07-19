# Program: function_minimization

## Goal

Find the global minimum of a hard, multi-modal 2D test function (the Rastrigin
function) as accurately as possible, using the search strategy implemented in
`code/search.py`.

The Rastrigin function has many local minima and a single global minimum of
`0.0` at the origin `(0, 0)`. Naive local search gets trapped easily, so the
interesting work is in the search strategy.

## Target metric

`score = -best_value_found`

Since the true minimum is `0.0`, the best achievable score is `0.0` (approached
from below). Higher (closer to 0) is better.

**Target:** reach `best_value_found <= 1e-3` (i.e. `score >= -1e-3`).

## Evaluation contract

`code/evaluate.py`:

- imports `search()` from `code/search.py`
- calls it with a fixed budget of `2000` function evaluations and a fixed seed
- prints one JSON line: `{"score": -best, "valid": true, "metrics": {"best": best, "evals": n}}`

The evaluator is authoritative. Do not change the objective function or the
evaluation budget — only improve `search.py`.
