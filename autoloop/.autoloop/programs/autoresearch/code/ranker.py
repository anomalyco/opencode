"""Document ranking heuristic. THIS is the file Autoloop optimizes.

Baseline: raw term-frequency (count of query terms in the document). Improve
`score_document` to raise Mean Average Precision — e.g. IDF weighting, length
normalization, phrase/proximity bonuses. You may add module-level state computed
from the corpus (passed via `set_corpus`) but must not read the labels.

Pure Python standard library only.
"""

import re

_TOKEN = re.compile(r"[a-z]+")

# Optional corpus statistics the loop may populate for IDF-style weighting.
_CORPUS_STATS = {}


def tokenize(text):
    return _TOKEN.findall(text.lower())


def set_corpus(all_docs):
    """Called once by the evaluator with the full flat list of doc strings.
    Baseline ignores it; improved versions may compute IDF here."""
    _CORPUS_STATS.clear()
    _CORPUS_STATS["ndocs"] = len(all_docs)


def score_document(query_terms, doc):
    """Return a relevance score for `doc` against `query_terms`.

    Args:
        query_terms: list of lowercased query tokens.
        doc: raw document string.
    """
    tokens = tokenize(doc)
    counts = {}
    for t in tokens:
        counts[t] = counts.get(t, 0) + 1
    return float(sum(counts.get(q, 0) for q in query_terms))
