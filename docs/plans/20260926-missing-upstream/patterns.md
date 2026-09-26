# Patterns — 20260926-missing-upstream (local, 2026-09-26)

- [2026-09-26] Scope pinned to v2.0.16 only: missing-upstream assessment compares the series against the `v2.0.16` tag, not a floating `origin/dev` tip. Do not widen to tip-ahead drift without an explicit scope decision. Source: researcher `task_clarifications`.
- [2026-09-26] Full commit detail required: record per-commit SHA, subject, and files touched — summary-level ("N commits missing") is insufficient for the compat call. Source: researcher `task_clarifications`.
- [2026-09-26] Ref priority: `origin/dev` is primary truth, `v2`/tags are secondary corroboration (`dev` primary + `v2`/tags). When they disagree, `origin/dev` wins; tags confirm release containment only. Source: researcher `task_clarifications` + `architectural_decisions`.
- [2026-09-26] Scope is series/v2.0.16 only: the missing set is (series commits) minus (already in v2.0.16). Commits outside the series are out of scope for this assessment. Source: researcher `architectural_decisions`.
- [2026-09-26] Full detail with compat assessment: every missing commit gets a compat call (carries over / obsolete-merged-upstream / obsolete-restructured / fork-specific re-apply), not just present/absent. Source: researcher `architectural_decisions`.
- [2026-09-26] Assumption (explicit): researcher `task_clarifications` + `architectural_decisions` taken as given, not re-verified here — no `git log`, no tag inspected, no code read. Transcription only into local plan memory; no global promotion. See `gotchas.md` (gray areas) + `fixes.md` (inventory).
