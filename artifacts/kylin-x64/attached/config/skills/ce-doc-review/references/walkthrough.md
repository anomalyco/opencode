# Per-finding Walk-through

This reference defines Interactive mode's per-finding walk-through — the path the user enters by picking option A (`Review each finding one by one — accept the recommendation or choose another action`) from the routing question, plus the unified completion report that every terminal path (walk-through, best-judgment, Append-to-Open-Questions, zero findings) emits.

Interactive mode only.

---

## Routing question (the entry point)

After `safe_auto` fixes apply and synthesis produces the remaining finding set, the orchestrator asks a four-option routing question before any walk-through or bulk action runs.

Use the platform's blocking question tool (`AskUserQuestion` in Claude Code, `request_user_input` in Codex, `ask_user` in Gemini, `ask_user` in Pi (requires the `pi-ask-user` extension)). In Claude Code, the tool should already be loaded from the Interactive-mode pre-load step in `SKILL.md` — if it isn't, call `ToolSearch` with query `select:AskUserQuestion` now. Fall back to presenting the options as a numbered list only when the harness genuinely lacks a blocking tool — `ToolSearch` returns no match, the tool call explicitly fails, or the runtime mode does not expose it (e.g., Codex edit modes without `request_user_input`). A pending schema load is not a fallback trigger. Never silently skip the question. Rendering the routing question as narrative text without the numbered-list fallback is a bug.

**Stem:** `What should the agent do with the remaining N findings?`

**Options (fixed order; no option is labeled `(recommended)` — the routing choice is user-intent):**

```
A. Review each finding one by one — accept the recommendation or choose another action
B. Auto-resolve with best judgment — apply per-finding edits the agent can defend, surface the rest
C. Append findings to the doc's Open Questions section and proceed
D. Report only — take no further action
```

The per-finding `(recommended)` labeling lives inside the walk-through (option A) and the bulk preview (options B/C), where it's applied per-finding from synthesis step 3.5b's `recommended_action`. The routing question itself does not recommend one of A/B/C/D because the right route depends on user intent (engage / trust / triage / skim), not on the finding-set shape — a rule that mapped finding-set shape to routing recommendation (e.g., "most findings are Apply-shaped → recommend best-judgment") would pressure users toward automated paths in ways that conflict with the user-intent framing.

If all remaining findings are FYI-subsection-only (no `gated_auto` or `manual` findings at confidence anchor `75` or `100`), skip the routing question entirely and flow to the Phase 5 terminal question.

**Append-availability adaptation.** When `references/open-questions-defer.md` has cached `append_available: false` at Phase 4 start (e.g., read-only document, unwritable filesystem), option C is suppressed from the routing question because every per-finding Defer would fail into the open-questions failure path. The menu shows three options (A / B / D) and the stem appends one line explaining why (e.g., `Append to Open Questions unavailable — document is read-only in this environment.`). This mirrors the per-finding option B suppression described under "Adaptations" below — both routing-level and per-finding Defer paths share the same availability signal so the user never sees Defer surfaced at one level and omitted at the other.

**Dispatch by selection:**

- **A** — load this walk-through (per-finding loop). Apply decisions accumulate in memory; Open-Questions defers execute inline via `references/open-questions-defer.md`; Skip decisions are recorded as no-action; `Auto-resolve with best judgment on the rest` routes through `references/bulk-preview.md`.
- **B** — load `references/bulk-preview.md` scoped to every pending `gated_auto` / `manual` finding. On Proceed, execute the plan: Apply → end-of-batch document edit; Open-Questions defers → `references/open-questions-defer.md`; Skip → no-op. On Cancel, return to the routing question.
- **C** — load `references/bulk-preview.md` with every pending finding in the Open-Questions bucket (regardless of the agent's natural recommendation). On Proceed, route every finding through `references/open-questions-defer.md`; no document edits apply. On Cancel, return to the routing question.
- **D** — do not enter any dispatch phase. Emit the completion report and flow to Phase 5 terminal question.

---

## Entry (walk-through mode)

The walk-through receives, from the orchestrator:

- The merged findings list in severity order (P0 → P1 → P2 → P3), filtered to actionable findings (confidence anchor `75` or `100` with `autofix_class` `gated_auto` or `manual`). FYI-subsection findings (anchor `50`) are not included — they surface in the final report only and have no walk-through entry.
- The run id for artifact lookups (when applicable).
- Premise-dependency chain annotations from synthesis step 3.5c: each finding may carry `depends_on: <root_id>` or `dependents: [<ids>]`.

Each finding's recommended action has already been normalized by synthesis step 3.5b (Deterministic Recommended-Action Tie-Break, `Skip > Defer > Apply`) — the walk-through surfaces that recommendation via the merged finding's `recommended_action` field and does not recompute it.

**Root-first iteration order.** When a finding has `dependents`, iterate it before any of its dependents regardless of severity order within the chain. The root always comes first so the user's root decision can cascade.

**Cascading root decisions.** When the user picks Skip or Defer on a finding with `dependents`:

1. Announce the cascade in the terminal before firing the next question: "Skipping/Deferring this root will auto-resolve N dependent finding(s): {titles}. Continue?"
2. Use the platform's blocking question tool with two options: `Cascade — apply same action to all dependents` (recommended) and `Decide each dependent individually`. Labels must be self-contained per the blocking-question tool design rules.
3. On Cascade: apply the root's action to every dependent and skip those findings' walk-through entries. Persistence follows the per-action routing rules from "Per-finding routing" below — the canonical home for every cascaded decision is the in-memory decision list (annotated with `cascaded from {root_title}` and the cascaded action), plus any action-specific side effect:
   - Cascaded `Apply` — add the dependent id to the Apply set and record in the decision list.
   - Cascaded `Defer` — invoke the open-questions append flow for the dependent and record the append outcome in the decision list. If the append fails, fall back to the per-finding failure path (Retry / Record only / Convert to Skip) for that dependent before advancing the cascade.
   - Cascaded `Skip` — record in the decision list only; no Apply-set entry, no open-questions append.

   On Individual: proceed normally — the root's dependents each get their own walk-through entry.

When the user picks Apply on a root, do NOT cascade — the premise held, so dependents each need their own decision. Proceed through the walk-through normally.

**Orphaned dependents.** If a dependent's root was rejected in a prior round and the root is suppressed this round (per R29), treat the dependent as a standalone finding with no chain context. Do not reference the missing root.

---

## Per-finding presentation

Each finding is presented in two parts: a terminal output block carrying the explanation, and a question via the platform's blocking question tool carrying the decision. Never merge the two — the terminal block uses markdown; the question uses plain text.

### Terminal output block (print before firing the question)

Render as markdown. Labels on their own line, blank lines between sections:

```
## Finding {N} of {M} — {severity} {plain-English title}

Section: {section}

**What's wrong**

{plain-English problem statement from why_it_matters}

**Proposed fix**

{suggested_fix — rendered per the substitution rules below: prose-first, intent-language}

**Why it works**

{short reasoning, grounded in a pattern cited in the document or codebase when available}

{Conflict-context line, when applicable — see below}
```

Substitutions:

- **`{plain-English title}`** — a 3–8 word summary suitable as a heading. Derived from the merged finding's `title` field but rephrased so it reads as observable consequence (e.g., "Implementers will pick different tiers" rather than "Section X-Y lists four tiers"). For document-review findings, observable consequence is the *effect on a reader, implementer, or downstream decision*, not runtime behavior.
- **`{section}`** — from the finding's `section` field.
- **`why_it_matters`** — from the merged finding's `why_it_matters` field. Rendered as-is; the subagent template's framing guidance ensures it's already observable-consequence-first.
- **`suggested_fix`** — from the merged finding's `suggested_fix` field. Render as prose describing intent, not as raw markup. The user's job is to trust or reject the action — they don't need to review exact text. Rules:
  - **Default — one sentence describing the effect.** What does the fix achieve, and where does it live? Prefer intent language over quoted text.
    - Good: `Drop the Advisory tier from the enum; advisory-style findings surface in an FYI subsection at the presentation layer.`
    - Good: `Add a deployment-ordering constraint requiring Units 3 and 4 in a single commit.`
    - Bad: `Change "autofix_class: [auto, gated_auto, advisory, present]" to "autofix_class: [safe_auto, gated_auto, manual]" in findings-schema.json on line 48.` — too syntax-focused for a decision loop
  - **Code-span budget** — at most 2 inline backtick spans per sentence, each a single identifier, flag, or short phrase (e.g., `` `safe_auto` ``, `` `<work-context>` ``). Always leave a space before and after each backtick span.
  - **Raw code blocks** — only for short (≤5-line) genuinely additive content where no before-state exists. Above 5 lines, switch to a summary.
  - **No diff blocks.** Document mutations render as prose.
- **`Why it works`** — grounded reasoning that, where possible, references a similar pattern already used in the document or codebase. One to three sentences.
- **Conflict-context line (when applicable)** — when contributing personas implied different actions for this finding and synthesis step 3.6 broke the tie, surface that briefly. Example: `Coherence recommends Apply; scope-guardian recommends Skip. Agent's recommendation: Skip.` The orchestrator's recommendation — the post-tie-break value — is what the menu labels "recommended."

### Question stem (short, decision-focused)

After the terminal block renders, fire the platform's blocking question tool with a compact two-line stem:

```
Finding {N} of {M} — {severity} {short handle}.
{Action framing in a phrase}?
```

Where:

- **Short handle** matches the `{plain-English title}` from the terminal block heading.
- **Action framing** — one phrase describing what the single recommended action does, as a yes/no question. Examples: `Apply the rename?`, `Defer to Open Questions since the tradeoff is genuine?`, `Skip since the document already resolves this elsewhere?`.

Never enumerate alternatives in the stem. One recommendation as a yes/no — the option list carries the alternatives. When the recommendation is close, surface the disagreement in the conflict-context line, not as a multi-option stem.

### Confirmation between findings

After the user answers and before printing the next finding's terminal block, emit a one-line confirmation of the action taken. Examples: `→ Applied. Edit staged at "Scope Boundaries" section.`, `→ Deferred. Entry appended to "## Deferred / Open Questions".`, `→ Skipped.`

### Options (four; adapted as noted)

These four options are the **complete, exclusive set** for the regular per-finding question. Fixed order — never reorder, never add, never substitute. In particular, **`Acknowledge` is NOT one of these options** — it appears only in the no-fix sub-question described under "Per-finding routing" below, which fires only when the user picks Apply on a finding that lacks a `suggested_fix`. Importing `Acknowledge` into the regular menu (in place of D, or as a fifth option) is a bug — it silently drops the `Auto-resolve with best judgment on the rest` workflow shortcut, and surfacing `Acknowledge` outside the no-fix path mislabels the user's choice in the completion report's bucket counts.

```
A. Apply the proposed fix
B. Defer — append to the doc's Open Questions section
C. Skip — don't apply, don't append
D. Auto-resolve with best judgment on the rest
```

**Mark the post-tie-break recommendation with `(recommended)` on its option label.** Required, not optional. Only A, B, or C can carry it — synthesis emits `recommended_action` as Apply/Defer/Skip, which maps to A/B/C. D (`Auto-resolve with best judgment on the rest`) is a workflow shortcut for bulk execution across remaining findings, not a finding-level resolution action, so it is never marked `(recommended)`.

```
A. Apply the proposed fix  (recommended)
B. Defer — append to the doc's Open Questions section
C. Skip — don't apply, don't append
D. Auto-resolve with best judgment on the rest
```

When reviewers disagreed or evidence cuts against the default, still mark one option — whichever synthesis produced — and surface the disagreement in the conflict-context line.

### Adaptations

- **N=1 (exactly one pending finding):** the terminal block's heading omits `Finding N of M` and renders as `## {severity} {plain-English title}`. The stem's first line drops the position counter, becoming `{severity} {short handle}.` Option D (`Auto-resolve with best judgment on the rest`) is suppressed because no subsequent findings exist — the menu shows three options: Apply / Defer / Skip.

- **Open-Questions append unavailable** (read-only document, write-failed): when `references/open-questions-defer.md` reports the in-doc append mechanic cannot run, option B is omitted. The stem appends one line explaining why (e.g., `Defer unavailable — document is read-only in this environment.`). The menu shows three options: Apply / Skip / Auto-resolve with best judgment on the rest. Before rendering options, remap any per-finding `Defer` recommendation from synthesis to `Skip` so the `(recommended)` marker lands on an option that's actually in the menu. Surface the remap on the conflict-context line (e.g., `Synthesis recommended Defer; downgraded to Skip — document is read-only.`).

- **Combined N=1 + no-append:** the menu shows two options: Apply / Skip.

Only when `ToolSearch` explicitly returns no match or the tool call errors — or on a platform with no blocking question tool — fall back to presenting the options as a numbered list and waiting for the user's next reply.

---

## Per-finding routing

For each finding's answer:

- **Apply the proposed fix** — add the finding's id to an in-memory Apply set. Advance to the next finding. Do not edit the document inline — Apply accumulates for end-of-walk-through batch execution. **No-fix guard:** if the merged finding has no `suggested_fix` (possible on `manual` findings where the persona flagged the issue as observation without a concrete resolution), Apply is not executable. Do not add the finding to the Apply set. Instead, surface the no-fix sub-question described below before advancing.
- **Defer — append to Open Questions section** — invoke the append flow from `references/open-questions-defer.md`. The walk-through's position indicator stays on the current finding during any failure-path sub-question (Retry / Fall back / Convert to Skip). On success, record the append location and reference in the in-memory decision list and advance. On conversion-to-Skip from the failure path, advance with the failure noted in the completion report.
- **Skip — don't apply, don't append** — record Skip in the in-memory decision list. Advance. No side effects.
- **Auto-resolve with best judgment on the rest** — exit the walk-through loop. Dispatch the bulk preview from `references/bulk-preview.md`, scoped to the current finding and everything not yet decided. The preview header reports the count of already-decided findings ("K already decided"). If the user picks Cancel from the preview, return to the current finding's per-finding question (not to the routing question). If the user picks Proceed, execute the plan per `references/bulk-preview.md` — Apply findings join the in-memory Apply set with the ones the user already picked, Defer findings route through `references/open-questions-defer.md`, Skip is no-op — then proceed to end-of-walk-through execution.

### No-fix sub-question (Apply picked on a finding with no `suggested_fix`)

This sub-question — and the `Acknowledge without applying` option in particular — is **exclusive to the no-fix path**. It fires only after the user picks Apply on a finding whose merged record has no `suggested_fix`. Do not surface this sub-question, or its `Acknowledge` option, in the regular per-finding menu. The regular menu's fourth option is always `Auto-resolve with best judgment on the rest` (per "Options" above), never `Acknowledge`.

Synthesis step 3.5b demotes the default recommendation from Apply to Defer for any merged finding without a `suggested_fix`, so `(recommended)` never lands on Apply for these findings. But the menu still lets the user pick Apply manually. When that happens, do not add the finding to the Apply set — the execution pass has no edit payload to apply, which would either fail the batch or record a misleading "applied" outcome.

Fire a blocking sub-question using the platform's question tool. The stem explains why Apply is not executable in one line, then offers three self-contained options. Position indicator stays on the current finding while the sub-question is open.

**Stem:** `Apply isn't executable for this finding — the review surfaced the issue without a concrete fix. How should the agent proceed?`

**Options (fixed order):**

```
A. Defer to Open Questions  (recommended)
B. Skip — don't apply, don't append
C. Acknowledge without applying — record the decision, no document edit
```

**Routing:**

- **A. Defer to Open Questions** — invoke the append flow from `references/open-questions-defer.md` as though the user had originally picked Defer. Failure-path handling is identical (Retry / Fall back / Convert to Skip). On success, record the append location in the decision list (annotated `redirected from Apply — no suggested_fix`) and advance.
- **B. Skip** — record Skip in the decision list (annotated `redirected from Apply — no suggested_fix`). Advance. No side effects.
- **C. Acknowledge without applying** — record the finding in the decision list as `acknowledged` (annotated `Apply picked but no suggested_fix — no edit dispatched`). Do not add to the Apply set. Advance. The completion report surfaces Acknowledged as its own dedicated bucket with its own count, its own per-finding action label, and its own position in the report ordering (`Applied / Deferred / Skipped / Acknowledged`) — see "Minimum required fields" and "Report ordering" in the unified completion report section below for the full contract. The acknowledgement reason is surfaced on each per-finding line. For round-to-round suppression (distinct from report display), Acknowledged decisions carry forward in the multi-round decision primer as a rejected-class decision alongside Skip and Defer so round-N+1 synthesis suppresses re-raises via R29 — semantically the user saw the finding, chose not to act, and wants it recorded, which is equivalent to Skip for suppression purposes but remains its own bucket in the report.

**Availability adaptation.** When `references/open-questions-defer.md` has cached `append_available: false` for the session, omit option A and surface one line in the stem explaining why (e.g., `Defer unavailable — document is read-only in this environment.`). The menu becomes Skip / Acknowledge without applying, with Skip labeled `(recommended)`.

**Cascading roots.** When the finding is a root with dependents and the user picks A (Defer) or B (Skip) from this sub-question, run the cascade announcement in "Cascading root decisions" above — treat the sub-question's choice as the root's effective action. Option C (Acknowledge) does not cascade; the root is recorded as acknowledged and dependents each get their own walk-through entry.

---

## Override rule

"Override" means the user picks a different preset action (Defer or Skip in place of Apply, or Apply in place of the agent's recommendation). No inline freeform custom-fix authoring — the walk-through is a decision loop, not a pair-editing surface. A user who wants a variant of the proposed fix picks Skip and hand-edits outside the flow; if they also want the finding tracked, they can Defer first and edit afterward.

---

## State

Walk-through state is **in-memory only**. The orchestrator maintains:

- An Apply set (finding ids the user picked Apply on)
- A decision list (every answered finding with its action and any metadata like `append_location` for Deferred or `reason` for Skipped)
- The current position in the findings list

Nothing is written to disk per-decision except the in-doc Open Questions appends (which are external side effects — those cannot be rolled back). An interrupted walk-through (user cancels the prompt, session compacts, network dies) discards all in-memory state. Apply decisions have not been dispatched yet (they batch at end-of-walk-through), so they are cleanly lost with no document changes.

Cross-session persistence is out of scope. Mirrors `ce-code-review`'s walk-through state rules.

---

## End-of-walk-through execution

After the loop terminates — either every finding has been answered, or the user took `Auto-resolve with best judgment on the rest → Proceed` — the walk-through hands off to the execution phase:

1. **Apply set:** in a single pass, the orchestrator applies every accumulated Apply-set finding's `suggested_fix` to the document. Document edits happen inline via the platform's edit tool — ce-doc-review has no batch-fixer subagent (per scope boundary); the orchestrator performs the edits directly, since `gated_auto` and `manual` fixes for documents are single-file markdown changes with no cross-file dependencies. **Defensive no-fix check:** before dispatching the edit for each Apply-set entry, verify the merged finding carries a `suggested_fix`. If it does not (the decision-time no-fix guard in "Per-finding routing" should prevent this, but treat it as a defensive fallback), skip the edit, record the finding in the completion report's failure section with reason `Apply skipped — no suggested_fix available`, and continue the batch. Do not fail the entire pass because one Apply-set entry lacks a fix.
2. **Defer set:** already executed inline during the walk-through via `references/open-questions-defer.md`. Nothing to dispatch here.
3. **Skip:** no-op.

After execution completes (or after `Auto-resolve with best judgment on the rest → Cancel` followed by the user working through remaining findings one at a time, or after the loop runs to completion), emit the unified completion report described below.

---

## Unified completion report

Every terminal path of Interactive mode emits the same completion report structure. This covers:

- Walk-through completed (all findings answered)
- Walk-through bailed via `Auto-resolve with best judgment on the rest → Proceed`
- Top-level best-judgment (routing option B) completed
- Top-level Append-to-Open-Questions (routing option C) completed
- Zero findings after `safe_auto` (routing question was skipped — the completion summary is a one-line degenerate case of this structure)

### Minimum required fields

- **Per-finding entries:** for every finding the flow touched, a line with — at minimum — title, severity, the action taken (Applied / Deferred / Skipped / Acknowledged), the append location for Deferred entries, a one-line reason for Skipped entries (grounded in the finding's confidence anchor or the one-line `why_it_matters` snippet), and the acknowledgement reason for Acknowledged entries (e.g., `Apply picked but no suggested_fix available`).
- **Summary counts by action:** totals per bucket (e.g., `4 applied, 2 deferred, 2 skipped`). Include an `acknowledged` count when any entries land in that bucket; omit the label when the count is zero.
- **Failures called out explicitly:** any Apply that failed (e.g., document write error, or the defensive no-fix fallback skipping an Apply-set entry), any Open-Questions append that failed. Failures surface above the per-finding list so they are not missed.
- **End-of-review verdict:** carried over from Phase 4's Coverage section.

### Report ordering

Failures first (above the per-finding list), then per-finding entries grouped by action bucket in the order `Applied / Deferred / Skipped / Acknowledged`, then summary counts, then Coverage (FYI observations, residual concerns), then the verdict. Omit any bucket whose count is zero.

### Zero-findings degenerate case

When the routing question was skipped because no `gated_auto` / `manual` findings at confidence anchor `75` or `100` remained after `safe_auto`, the completion report collapses to its summary-counts + verdict form with one added line — the count of `safe_auto` fixes applied. The summary wording:

No FYI or residual concerns:

```
All findings resolved — 3 fixes applied.

Verdict: Ready.
```

FYI or residual concerns remain:

```
All actionable findings resolved — 3 fixes applied. (2 FYI observations, 1 residual concern remain in the report.)

Verdict: Ready.
```

---

## Execution posture

The walk-through is operationally read-only with respect to the project except for three permitted writes: the in-memory Apply set / decision list (managed by the orchestrator), the in-doc Open Questions appends (external side effects managed by `references/open-questions-defer.md`), and the end-of-walk-through batch document edits (the orchestrator's final Apply pass). Persona agents remain strictly read-only. Unlike `ce-code-review`, there is no fixer subagent — the orchestrator owns the document edit directly.
