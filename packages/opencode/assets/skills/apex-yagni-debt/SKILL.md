---
name: APEX YAGNI-debt
description: >
  Harvest every `apex-yagni:` comment in the codebase into a debt ledger, so the
  deliberate shortcuts and deferrals APEX YAGNI leaves behind get tracked instead
  of rotting into "later means never". Use when the user says "APEX YAGNI debt",
  "/apex-yagni-debt", "what did APEX YAGNI defer", "list the shortcuts", "APEX YAGNI
  ledger", or "what did we mark to do later". One-shot report, changes nothing.
---

Every deliberate APEX YAGNI shortcut is marked with a `apex-yagni:` comment naming
its ceiling and upgrade path. This collects them into one ledger so a deferral
can't quietly become permanent.

## Scan

Grep the repo for comment markers, skipping `node_modules`, `.git`, and build
output:

`grep -rnE '(#|//) ?apex-yagni:' .`  (add other comment prefixes if your stack uses them)

Each hit is one ledger row. The comment prefix keeps prose that merely mentions
the convention out of the ledger.

## Output

One row per marker, grouped by file:

`<file>:<line>, <what was simplified>. ceiling: <the limit named>. upgrade: <the trigger to revisit>.`

The convention is `apex-yagni: <ceiling>, <upgrade path>`, so pull the ceiling
and the trigger straight from the comment. Want an owner per row too? add
`git blame -L<line>,<line>`.

Flag the rot risk: any `apex-yagni:` comment that names no upgrade path or
trigger gets a `no-trigger` tag, those are the ones that silently rot.

End with `<N> markers, <M> with no trigger.` Nothing found: `No apex-yagni: debt. Clean ledger.`

## Boundaries

Reads and reports only, changes nothing. To persist it, ask and it writes the
ledger to a file (e.g. `APEX YAGNI-DEBT.md`). One-shot. "stop APEX YAGNI-debt" or
"normal mode" to revert.
