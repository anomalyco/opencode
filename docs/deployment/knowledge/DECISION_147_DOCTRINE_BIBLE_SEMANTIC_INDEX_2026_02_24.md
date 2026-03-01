# DECISION_147 Learning Delta (2026-02-24)

## Decision Link

- `STR4TEG15T/memory/decisions/DECISION_147_DOCTRINE_BIBLE_SEMANTIC_INDEX_AND_AGENT_LOOKUP_TOOL.md`

## Reusable Retrieval Pattern

For doctrine corpora with many short post exports, retrieval quality improves when:

1. Keep a human index (`AGENTS.md`) and a machine index (`substack-semantic-index.json`) in parallel.
2. Expand queries through domain aliases (`vix/vanna/vomma`, `fomc/pce/cpi`, `window of risk`).
3. Apply metadata filter early (`postType`) before scoring/ranking.
4. Weight title hits higher than body token hits for noisy scraped text.

## Tool Anchor

- `OP3NF1XER/nate-alma/dev/skills/doctrine-engine/scripts/search_substack_teachings.py`

## Operator Benefit

Agents can now run deterministic local lookup against the full substack corpus without requiring ad-hoc grep patterns for each query.
