# Pattern: Skills Script Chaos Gate

## Trigger

Any pass touching multiple scripts under `nate-alma/dev/skills` or when runtime script stability is uncertain.

## Mandatory Sequence

1. Run full audit:
   - `python skills/script-sanity-kit/scripts/chaos_audit.py --json-out skills/script-sanity-kit/reports/latest-chaos-audit.json`
   - audit contract: read-only diagnostics only, no autofix mutations.
2. Review warning classes (no markers, missing fail-fast shell options, missing shebang, path coupling).
3. For execution-critical scripts, run through guard wrapper:
   - `python skills/script-sanity-kit/scripts/run_with_sanity.py --script <path> -- <args>`
4. Capture results in deployment journal with PASS/WARNING counts.

## Evidence Rule

- Store JSON audit report under `skills/script-sanity-kit/reports/`.
- Ensure each finding contains `line` and `recommendation` metadata.
- Include at least one guarded runtime sample showing preflight + runtime + mutation checks.

## Closure Rule

Do not claim script-lane hardening unless full skills scan has been executed, report artifact path is provided, and re-audit warning count is zero after remediation.
