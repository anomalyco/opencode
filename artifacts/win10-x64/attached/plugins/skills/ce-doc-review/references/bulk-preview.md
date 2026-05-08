# Bulk Action Preview

This reference defines the compact plan preview that Interactive mode shows before every bulk action — best-judgment (routing option B), Append-to-Open-Questions (routing option C), and the walk-through's `Auto-resolve with best judgment on the rest` (option D of the per-finding question). The preview gives the user a single-screen view of what the agent is about to do, with exactly two options to Proceed or Cancel.

Interactive mode only.

---

## When the preview fires

Three call sites:

1. **Routing option B (top-level best-judgment)** — after the user picks `Auto-resolve with best judgment — apply per-finding edits the agent can defend, surface the rest` from the routing question, but before any action executes. Scope: every pending `gated_auto` or `manual` finding at confidence anchor `75` or `100`.
2. **Routing option C (top-level Append-to-Open-Questions)** — after the user picks `Append findings to the doc's Open Questions section and proceed` but before any append runs. Scope: every pending `gated_auto` or `manual` finding at confidence anchor `75` or `100`. Every finding appears under `Appending to Open Questions (N):` regardless of the agent's natural recommendation, because option C is batch-defer.
3. **Walk-through `Auto-resolve with best judgment on the rest`** — after the user picks `Auto-resolve with best judgment on the rest` from a per-finding question, but before the remaining findings are resolved. Scope: the current finding and everything not yet decided. Already-decided findings from the walk-through are not included in the preview.

In all three cases the user confirms with `Proceed` or backs out with `Cancel`. No per-item decisions inside the preview — per-item decisioning is the walk-through's role.

---

## Preview structure

The preview is grouped by the action the agent intends to take. Bucket headers appear only when their bucket is non-empty.

```
<Path label> — <scope summary>:

Applying (N):
  [P0] <section> — <one-line plain-English summary>
  [P1] <section> — <one-line plain-English summary>

Appending to Open Questions (N):
  [P2] <section> — <one-line plain-English summary>

Skipping (N):
  [P2] <section> — <one-line plain-English summary>
```

Worked example for routing option B (top-level best-judgment):

```
Auto-resolve plan — 8 findings:

Applying (4):
  [P0] Requirements Trace — Renumber R4 to match unit reference
  [P1] Unit 3 Files — Add read-fallback for renamed report file
  [P2] Key Technical Decisions — Use framework's Deprecated field rather than hand-rolling
  [P3] Overview — Correct wrong count (says 6, list has 5)

Appending to Open Questions (2):
  [P2] Scope Boundaries — Unit 2/3 merge judgment call
  [P2] Risks — Alias compatibility-theater concern

Skipping (2):
  [P2] Miscellaneous Notes — Low-confidence style preference
  [P3] Abstraction Commentary — Speculative, subjective
```

---

## Scope summary wording by path

- **Routing option B (top-level best-judgment):** header reads `Auto-resolve plan — N findings:`.
- **Routing option C (top-level Append-to-Open-Questions):** header reads `Append plan — N findings as Open Questions entries:`. Every finding lands in the `Appending to Open Questions (N):` bucket.
- **Walk-through `Auto-resolve with best judgment on the rest`:** header reads `Auto-resolve plan — N remaining findings (K already decided):`. Already-decided findings from the walk-through are not included in the preview or in the bucket counts. The `K already decided` counter communicates that the walk-through was partially completed.

---

## Per-finding line format

Each line uses the compressed form of the framing-quality guidance from the subagent template (observable-consequence-first, no internal section numbering unless needed to locate). The one-line summary is drawn from the persona-produced `why_it_matters` by taking the first sentence (and, when the first sentence is too long for the preview width, paraphrasing it tightly to fit).

- **Shape:** `[<severity>] <section> — <one-line summary>`
- **Width target:** keep lines near 80 columns so the preview renders cleanly in narrow terminals. Truncate with ellipsis when necessary.
- **No section numbering** unless the reader needs it to locate the issue (when multiple findings hit the same named section).

When no `why_it_matters` is available for a finding (rare — only if persona output was malformed), fall back to the finding's title directly. Note the gap in the completion report's Coverage section if it affects more than a few findings in the same run.

---

## Question and options

After the preview body is rendered, ask the user using the platform's blocking question tool (`AskUserQuestion` in Claude Code, `request_user_input` in Codex, `ask_user` in Gemini, `ask_user` in Pi (requires the `pi-ask-user` extension)). In Claude Code, the tool should already be loaded from the Interactive-mode pre-load step — if it isn't, call `ToolSearch` with query `select:AskUserQuestion` now. The text fallback below applies only when the harness genuinely lacks a blocking tool — `ToolSearch` returns no match, the tool call explicitly fails, or the runtime mode does not expose it (e.g., Codex edit modes without `request_user_input`). A pending schema load is not a fallback trigger. Never silently skip the question.

Stem (adapted to the path):

- For routing B: `The agent is about to apply the plan above. Proceed?`
- For routing C: `The agent is about to append the findings above to the doc's Open Questions section. Proceed?`
- For walk-through `Auto-resolve with best judgment on the rest`: `The agent is about to resolve the remaining findings above. Proceed?`

Options (exactly two, in all three cases):

- `Proceed` — execute the plan as shown
- `Cancel` — do nothing, return to the originating question

Only when `ToolSearch` explicitly returns no match or the tool call errors — or on a platform with no blocking question tool — fall back to presenting numbered options and waiting for the user's next reply.

---

## Cancel semantics

- **From routing option B Cancel:** return the user to the routing question (the four-option menu). Do not edit the document, do not append any Open Questions entries, do not record any state.
- **From routing option C Cancel:** same — return to the routing question, no side effects.
- **From walk-through `Auto-resolve with best judgment on the rest` Cancel:** return the user to the current finding's per-finding question (not to the routing question). The walk-through continues from where it was, with prior decisions intact.

In every case, `Cancel` changes no on-disk or in-memory state.

---

## Proceed semantics

When the user picks `Proceed`:

- **Routing option B (top-level best-judgment):** for each finding in the plan, execute the recommended action. Apply findings go into the Apply set for a single end-of-batch document-edit pass (see `walkthrough.md` for the Apply batching rules). Defer findings route through `references/open-questions-defer.md`. Skip findings are recorded as no-action. After all actions complete, emit the unified completion report (see `walkthrough.md`).
- **Routing option C (top-level Append-to-Open-Questions):** every finding routes through `references/open-questions-defer.md` for Open Questions append. No document edits apply (beyond the Open Questions section additions themselves). After all appends complete (or fail), emit the unified completion report.
- **Walk-through `Auto-resolve with best judgment on the rest`:** same as routing option B, but scoped to the findings the user hadn't decided on. Apply findings join the in-memory Apply set with the ones the user already picked during the walk-through; all dispatch together in the single end-of-walk-through Apply pass.

Failure during `Proceed` (e.g., an Open Questions append fails for one finding during a batch Defer) follows the failure path defined in `references/open-questions-defer.md` — surface the failure inline with Retry / Fall back / Convert to Skip, continue with the rest of the plan, and capture the failure in the completion report's failure section.

---

## Edge cases

- **Zero findings in a bucket:** omit the bucket header. A preview with only Apply and Skip does not show an empty `Appending to Open Questions (0):` line.
- **All findings in one bucket:** preview still shows the bucket header; Proceed / Cancel still offered. This is the common case for routing option C (every finding under `Appending to Open Questions`).
- **N=1 preview (only one finding in scope):** the preview still uses the grouped format, just with a single-line bucket. `Proceed` / `Cancel` still apply.
- **Open Questions append unavailable** (document is read-only, append flow reports no-go): routing option C is not offered upstream (see `references/open-questions-defer.md` unavailability handling). Best-judgment (option B) and walk-through `Auto-resolve with best judgment on the rest` can still run — they may contain per-finding Defer recommendations from synthesis. Before rendering any best-judgment-shaped preview, downgrade every Defer recommendation to Skip when the session's cached append-availability is false, and surface the downgrade on the preview itself (e.g., a `Skipping — append unavailable (N):` bucket, or a note in the header: `N Defer recommendations downgraded to Skip — document is read-only.`).
- **Walk-through `Auto-resolve with best judgment on the rest` with zero remaining findings:** the walk-through's own logic suppresses `Auto-resolve with best judgment on the rest` as an option when N=1 and otherwise, so the preview should never be invoked with zero remaining findings. If it is, render `Auto-resolve plan — 0 remaining findings` and fall through to Proceed with no-op.
