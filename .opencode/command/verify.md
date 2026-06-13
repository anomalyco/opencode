---
description: Run the verification gate (typecheck, test, lint) and fix any failures
subtask: true
---

Run the verification gate for the package you changed, then fix whatever it reports.

The gate runs real tools — it is the source of truth, not your own judgement. Do not claim a proof,
a complexity (Big-O), or a security result that the tools did not actually produce.

## Gate result

!`bun run script/verify.ts --json $ARGUMENTS`

## What to do with it

- If `status` is `pass`, summarize the evidence (test counts, coverage) and stop.
- If any gate `status` is `fail`, read that gate's `evidence`, fix the underlying code, and re-run
  `/verify`. Never edit a test just to make it pass.
- Tests run from the package directory, never from the repo root.
- This is one tool cycle: do not spawn extra agents or model calls to "double-check" the result.
