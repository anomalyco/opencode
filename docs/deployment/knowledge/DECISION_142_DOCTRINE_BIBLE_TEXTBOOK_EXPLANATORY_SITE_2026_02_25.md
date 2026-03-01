# DECISION_142 Learning Delta (2026-02-25)

## Decision Link

- `STR4TEG15T/memory/decisions/DECISION_142_DOCTRINE_BIBLE_TEXTBOOK_EXPLANATORY_SITE.md`

## Problem Class

Static site generation produced an archive (links + raw exports), not a textbook.

## Reusable Fix Pattern

### 1) Separate “teaching” from “sources”

- Keep captured corpus pages as <em>source material</em>.
- Add human-first chapter guides that teach concepts with:
  - Core Concepts
  - How To Apply
  - Common Mistakes
  - Self-Check
  - Citations (local corpus paths)
  - Further Reading (external links only)

### 2) Inject guides via generator (not manual edits)

- Create per-chapter HTML fragments under:
  - `STR4TEG15T/tools/workspace/memory/doctrine-bible/site/guides/*.html`
- Update generator to embed those fragments into:
  - `site/chapters/chapter-*.html`

This avoids hand-edit drift and enables iterative “passes” by editing guide fragments and regenerating.

### 3) Navigation hardening

- Add within-page Table of Contents for h2/h3 headings.
- Style citations and TOC for scanning.
- Fix search index assumptions:
  - Don’t assume `content/tags` exist if index only has `title/excerpt/chapter`.
  - Load `search-index.json` from both root and `../` to support subpages.

## Files Anchors

- Generator: `STR4TEG15T/tools/workspace/memory/doctrine-bible/site/generate_pages.py`
- Guides: `STR4TEG15T/tools/workspace/memory/doctrine-bible/site/guides/`
- UI JS: `STR4TEG15T/tools/workspace/memory/doctrine-bible/site/js/app.js`
- UI CSS: `STR4TEG15T/tools/workspace/memory/doctrine-bible/site/css/styles.css`
