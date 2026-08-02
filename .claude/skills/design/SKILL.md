---
name: design
description: Settle a design before any ticket exists — sort the open questions into decided, provable and judgment, run a real probe for everything provable, and write the result to a Linear document. Invoked only when /write-ticket's design checklist fails.
allowed-tools: Read, Grep, Glob, Bash, Edit, Write, AskUserQuestion, Agent, WebSearch, WebFetch, mcp__linear-axiomic__*
---

# design

**You do not invoke this directly.** `/write-ticket` runs a checklist and sends work
here when the design is not yet settled — most often because nobody can yet say what
they would run to see the outcome.

This exists because the workflow's entry point used to be the ticket, which silently
assumed the design was already decided. Scheduling AXI-142 before AXI-131 was a design
error made before any ticket existed, and no gate downstream could catch it — it was
the largest single error of that session.

The output is **a Linear document**: a list of decisions, each with the evidence that
settled it. Not an essay.

## The rule that keeps this from becoming a prose swamp

**Anything a probe can settle MUST be settled by a probe.** You do not get to argue
about something you could run. That single rule is the difference between this skill
and the plan review it replaces — which reviewed prose about code that did not exist,
and so could not falsify most of what it found.

## 1. Frame the outcome

One sentence of world-state change, same altitude as a ticket's. If it cannot be
stated, the problem is not understood well enough to design against — say so.

## 2. Enumerate the open questions

Every decision the work depends on: data models, boundaries, sequencing, what is in
scope. Then sort each one:

- **Decided** — the constraints already settle it. Write it down with the constraint
  that forces it, and move on. Do not deliberate settled things.
- **Provable** — a probe decides it. **Mandatory**, not optional.
- **Judgment** — several defensible answers and no experiment separates them. The
  owner decides.

Ordering questions is itself a question. *"Do we make this invariant hold in-path, or
structurally?"* is provable: try it. If in-path cleanup cannot survive adversarial
interruption, that is a finding, not an opinion — and it arrives before any code.

## 3. Run the probes

Throwaway is fine; real is required. Spin up the actual database, drive the actual
endpoint, plant the actual fixture. Precedent worth copying: AXI-65's gate stood up
PostgreSQL 17.10, proved `jsonb_agg` over an empty set returns SQL NULL, proved
`jsonb_set` is strict via `pg_proc.proisstrict`, reproduced the crash on a two-row
table — **and refuted a proposed simplification with a mechanism.** Two rounds, zero
blockers.

Record what you ran and what it printed. A probe whose output is not written down has
to be run again by the next person.

You have a browser and a login (Playwright MCP, configured in every repo). Staging is
reachable via `/impersonate-customer`, `/staging-db` and
`AWS_PROFILE=axiomic-terraform` (region `us-east-2`). Very little is genuinely
unprovable — reach for a probe before reaching for an argument.

## 4. Bring the judgment calls to the owner

Batch them. For each: the options, what each costs, and a recommendation derived from
the problem's structure — not a menu (see "Operating mode: first principles" in
`CLAUDE.md`). Use `AskUserQuestion`.

This is the one irreducibly human step in the entire workflow. Across 118 historical
tickets exactly one verification was genuinely human — a design review the ticket
itself called "the only taste gate." Keep this list that short.

## 5. Decide what NOT to decide

Anything not load-bearing now gets designed *around*, not settled. Over-deciding is
this skill's other failure mode: it produces prose that the next round then audits.

## 6. Write the document

```
mcp__linear-axiomic__save_document(title: "<design title>", content: "<body>")
```

```markdown
## Outcome
<one sentence of world-state change>

## Decisions
| # | Question | How settled | Answer |
|---|---|---|---|
| 1 | ... | decided — <constraint> / probe — <what ran, what it printed> / judgment — owner | ... |

## Deliberately left open
- <question> — why it need not be settled now, and what keeps it cheap to settle later.

## Tickets this implies
- <outcome> — <the proof it will carry>
```

The last section is the point: each ticket leaves here with an outcome and a nameable
proof, which is exactly what `/write-ticket`'s checklist was failing on.

Linear documents, not a repo file — a design record is not code documentation, the
no-stray-docs hook allows only three markdown files per repo, and the record belongs
beside the tickets it produced.

## 7. Output
Report the document URL and the tickets it implies. Next step: `/write-ticket` for
each, which will now pass its checklist.

---

$ARGUMENTS
