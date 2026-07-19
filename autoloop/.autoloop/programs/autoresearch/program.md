# Program: autoresearch

## Goal

Discover a better **heuristic scoring function** for ranking candidate research
papers by relevance to a query, given a small labeled dataset. This is a stand-in
for automated research triage: the loop searches over ranking heuristics rather
than tuning a black-box model.

The heuristic lives in `code/ranker.py` as `score_document(query_terms, doc)`.
The baseline is a plain term-frequency count. Better heuristics (TF-IDF-like
weighting, length normalization, title boosts, proximity) rank the relevant
documents higher.

## Target metric

`score = mean_average_precision` (MAP) over the labeled queries in
`code/dataset.py`. Range `[0, 1]`, higher is better. The baseline scores
roughly `0.5-0.6`.

**Target:** reach `MAP >= 0.85`.

## Evaluation contract

`code/evaluate.py`:

- loads the fixed labeled dataset from `code/dataset.py`
- ranks each query's documents using `score_document`
- computes Mean Average Precision
- prints `{"score": map, "valid": true, "metrics": {"map": map}}`

Do not edit `dataset.py` or `evaluate.py` — only improve `ranker.py`.
Overfitting to the tiny dataset by hard-coding the labels is cheating and fails.
