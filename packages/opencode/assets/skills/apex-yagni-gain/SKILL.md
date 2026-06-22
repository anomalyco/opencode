---
name: APEX YAGNI-gain
description: >
  Show APEX YAGNI's measured impact as a compact scoreboard: less code, less
  cost, more speed, from the benchmark medians. One-shot display, not a
  persistent mode, and not a per-repo number. Trigger: /apex-yagni-gain,
  "APEX YAGNI gain", "what does APEX YAGNI save", "show APEX YAGNI impact",
  "APEX YAGNI scoreboard".
---

# APEX YAGNI Gain

Display this scoreboard when invoked. One-shot: do NOT change mode, write flag
files, or persist anything.

The figures are the published benchmark medians (5 everyday tasks: email
validator, debounce, CSV sum, countdown timer, rate limiter; three models:
Haiku, Sonnet, Opus). They are measured, not computed from the current repo.
Source: `benchmarks/` and the README.

## Scoreboard

Render plain ASCII bars. The bar length shows the measured range; the label
carries the exact figure:

```
  APEX YAGNI gain                     benchmark median · 5 tasks · 3 models

  Lines of code   no-skill  ████████████████████  100%
                  APEX YAGNI  ██▌·················    6–20%   ▼ 80–94%
  Cost            no-skill  ████████████████████  100%
                  APEX YAGNI  █████▌··············   23–53%  ▼ 47–77%
  Speed           APEX YAGNI  ▸ 3–6× faster

  This repo:  /apex-yagni-debt  (shortcuts you deferred)
              /apex-yagni-audit (what's still cuttable)
```

## Honesty boundary

These are benchmark medians, not this repo. NEVER print a per-repo savings
number ("you saved X lines/tokens here"): the unbuilt version was never
written, so there is no real baseline to subtract from in a live repo. The
only real per-repo figures come from `/apex-yagni-debt` (a counted ledger), and
this card points there instead of inventing one.

## Boundaries

One-shot display. Edits nothing, changes no mode.
"stop APEX YAGNI" or "normal mode": revert.
