# DECISION_159 Learning Delta (2026-02-25)

## Decision Link

- `STR4TEG15T/memory/decisions/DECISION_159_ALMA_TEACHINGS_SITE_EXPAND_REMAINING_GUIDES_PASS_3.md`

## Problem Class

Site pages feel “void” when chapter guide fragments lack teaching scaffolding (definitions + how-to + failure modes), even if the corpus exists and navigation works.

## Reusable Fix Pattern

### 1) Expand in guides, not in generated chapters

- Author content in `OP3NF1XER/nate-alma/dev/memory/alma-teachings/site/guides/*.html`.
- Regenerate `site/chapters/chapter-*.html` with `python generate_pages.py`.

### 2) Turn corpus into a guide section template

- Add per-guide sections in this minimal teaching order:
  - `Core Concepts` (definitions)
  - `How To Apply` (workflow/checklists)
  - `Common Mistakes` (failure modes)
  - `Self-Check` (questions)
  - `Citations` (local `bible/*.md` anchors)

### 3) Mechanics/principles/foundations anchors that work well

- Mechanics: speed profile, OpEx flows context-dependence, vomma supply, regime flips.
- Principles: expected value > accuracy, fair bet baseline, sizing/disciplined stop rules, guru vs analyst trap.
- Foundations: determinism vs stochasticism + emergence, realized vs implied vol, EMH vs deviations (momentum/mean reversion).

## Evidence Anchors (Corpus)

- `bible/unknown-date-opex-flows-pt-2-intraday-post-19-sept.md` (context-dependent flows)
- `bible/unknown-date-what-is-vomma-supply-why-is-it-important-intraday-post-04-se.md` (vomma supply framing)
- `bible/unknown-date-odds-fair-bet-and-kelly-criterion-position-sizing.md` (fair bet)
- `bible/unknown-date-game-of-probabilities.md` (determinism vs stochasticism + emergence)
- `bible/unknown-date-what-is-volatility.md` (volatility definition)
