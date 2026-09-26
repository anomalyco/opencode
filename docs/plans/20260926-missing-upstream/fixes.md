# Fixes (assessment inventory, not applied) — 20260926-missing-upstream
Updated: 2026-09-26 (researcher transcription, no backport implemented)

## [2026-09-26] Missing-upstream assessment — series vs v2.0.16
- Symptom/context: determine which series commits are absent from v2.0.16 and what each absence means for compat.
- Scope (as decided, unverified here): series commits only, compared against `v2.0.16` tag; `origin/dev` is primary truth, `v2`/tags secondary.
- Record per missing commit (full detail): SHA + subject + files touched + compat call (carries over / obsolete-merged-upstream / obsolete-restructured / fork-specific re-apply).
- Verify (before use): `git fetch origin dev --tags`; `git log --oneline v2.0.16..origin/dev -- <series paths>` to confirm tip-ahead vs tag scope; `git branch --contains <sha> --list 'v2*'` or `git tag --contains <sha>` per candidate; `git show --stat <sha>` per missing commit.
- Status: inventoried as assessment frame only; concrete missing-commit list with compat calls recorded here once produced; do NOT backport in this task.
