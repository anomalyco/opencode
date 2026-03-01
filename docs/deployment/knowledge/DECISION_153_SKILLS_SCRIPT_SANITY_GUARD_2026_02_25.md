# DECISION_153 Learning Delta (2026-02-25)

## Decision Link

- `STR4TEG15T/memory/decisions/DECISION_153_SKILLS_SCRIPT_SANITY_GUARD_AND_CHAOS_AUDIT.md`

## Assimilated Truth

- A central wrapper (`run_with_sanity.py`) scales better than hand-patching dozens of heterogeneous scripts while still enforcing runtime preflight checks.
- Full-tree chaos analysis should emit both human-readable logs and machine-readable JSON for repeatable audits.
- Mutation fingerprint checks (pre/post script hash) provide fast detection of unexpected self-modifying behavior.
- Script-lane stability requires explicit warning surfacing for shebang gaps, missing fail-fast shell flags, and path-coupling risk.

## Reusable Anchors

- `skills script chaos audit pass warning`
- `run with sanity preflight syntax hash mutation check`
- `nate alma skills runtime debug guard`
- `skills audit json report artifact`

## Evidence Paths

- `OP3NF1XER/nate-alma/dev/skills/script-sanity-kit/SKILL.md`
- `OP3NF1XER/nate-alma/dev/skills/script-sanity-kit/scripts/chaos_audit.py`
- `OP3NF1XER/nate-alma/dev/skills/script-sanity-kit/scripts/run_with_sanity.py`
- `OP3NF1XER/nate-alma/dev/skills/script-sanity-kit/reports/latest-chaos-audit.json`
- `OP3NF1XER/deployments/JOURNAL_2026-02-25_DECISION_153_SKILLS_SCRIPT_SANITY_GUARD.md`
