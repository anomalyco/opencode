"""Evaluator. DO NOT edit — defines scoring (Mean Average Precision)."""

import json

from dataset import DATASET
from ranker import score_document, set_corpus, tokenize


def average_precision(ranked_relevance):
    """ranked_relevance: list of 0/1 in ranked order. Returns AP."""
    hits = 0
    total = 0.0
    for i, rel in enumerate(ranked_relevance, start=1):
        if rel:
            hits += 1
            total += hits / i
    n_rel = sum(ranked_relevance)
    return total / n_rel if n_rel else 0.0


def main():
    all_docs = [d for q in DATASET for d in q["docs"]]
    try:
        set_corpus(all_docs)
    except Exception:  # noqa: BLE001
        pass

    aps = []
    valid = True
    try:
        for q in DATASET:
            qterms = tokenize(q["query"])
            scored = []
            for idx, doc in enumerate(q["docs"]):
                scored.append((score_document(qterms, doc), idx))
            scored.sort(key=lambda p: p[0], reverse=True)
            rel_set = set(q["relevant"])
            ranked_rel = [1 if idx in rel_set else 0 for _, idx in scored]
            aps.append(average_precision(ranked_rel))
    except Exception:  # noqa: BLE001
        valid = False

    if not valid or not aps:
        print(json.dumps({"score": 0.0, "valid": False, "metrics": {}}))
        return

    mean_ap = sum(aps) / len(aps)
    print(json.dumps({"score": mean_ap, "valid": True, "metrics": {"map": mean_ap}}))


if __name__ == "__main__":
    main()
