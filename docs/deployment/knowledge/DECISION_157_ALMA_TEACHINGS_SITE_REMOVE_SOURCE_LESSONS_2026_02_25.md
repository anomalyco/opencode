# DECISION_157 Learning Delta (2026-02-25)

## Decision Link

- `STR4TEG15T/memory/decisions/DECISION_157_ALMA_TEACHINGS_SITE_REMOVE_SOURCE_LESSONS_AND_EXPAND_GUIDES.md`

## Problem Class

Static site UI advertised “Lessons (Source Material)” but lesson pages were absent/blank, creating clutter + broken navigation.

## Reusable Fix Pattern

### 1) De-lesson the UI until lesson pages are real

- Remove lesson lists from chapter pages (generator-level, not manual HTML edits).
- Remove lesson links from sidebar nav and chapter nav.
- Route search clicks to chapter overviews when the search index is post-level but pages are disabled.

### 2) Keep the teaching surface intact

- Preserve chapter guides as the primary learning surface.
- Expand the thinnest guides first (start with the shortest guide file).

### 3) Keep citations honest

- Ensure citations point to the actual local corpus folder name (`bible/` here), not an old path (`substack/`).

## File Anchors

- Generator: `OP3NF1XER/nate-alma/dev/memory/alma-teachings/site/generate_pages.py`
- UI JS: `OP3NF1XER/nate-alma/dev/memory/alma-teachings/site/js/app.js`
- Home page: `OP3NF1XER/nate-alma/dev/memory/alma-teachings/site/index.html`
- Guide fragments: `OP3NF1XER/nate-alma/dev/memory/alma-teachings/site/guides/`
