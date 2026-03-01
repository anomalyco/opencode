# DECISION_158 Learning Delta (2026-02-25)

## Decision Link

- `STR4TEG15T/memory/decisions/DECISION_158_ALMA_TEACHINGS_SITE_EXPAND_BLANK_GUIDES_PASS_2.md`

## Problem Class

Chapter overviews are generated from `site/guides/*.html`; when guide fragments are thin, the site reads as “void” even if navigation works.

## Reusable Fix Pattern

### 1) Expand guide fragments, then regenerate

- Edit `OP3NF1XER/nate-alma/dev/memory/alma-teachings/site/guides/*.html` (human-authored surface).
- Regenerate with `python OP3NF1XER/nate-alma/dev/memory/alma-teachings/site/generate_pages.py` to refresh `site/chapters/chapter-*.html`.

### 2) Use `parts/` to pick topics, but cite `bible/` for authority

- `parts/alma-teachings-part-*.json` is a topic/tag index to find which corpus posts cover a concept.
- The guide content should be derived from `bible/*.md` and the citations list should point to those files.

### 3) “Blankest first” heuristic

- Start with the shortest guide file by line count (typically `assets`, `technical`, `macro`), then iterate.

## Known Friction

- Many `bible/*.md` captures are stored as a single long line; the standard Read tool truncates lines >2000 chars.
- When deeper quoting is needed, prefer adding a dedicated re-wrapping step (non-destructive copy) or a small slicing script for inspection.

## File Anchors

- Guides: `OP3NF1XER/nate-alma/dev/memory/alma-teachings/site/guides/`
- Generator: `OP3NF1XER/nate-alma/dev/memory/alma-teachings/site/generate_pages.py`
- Parts index: `OP3NF1XER/nate-alma/dev/memory/alma-teachings/parts/`
- Corpus: `OP3NF1XER/nate-alma/dev/memory/alma-teachings/bible/`
