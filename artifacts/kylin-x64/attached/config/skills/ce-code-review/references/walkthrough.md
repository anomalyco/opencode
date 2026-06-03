# Per-finding Walk-through

This reference defines Interactive mode's per-finding walk-through — the path the user enters by picking option A (`Review each finding one by one — accept the recommendation or choose another action`) from the routing question. It also covers the unified completion report that every terminal path (walk-through, best-judgment, File tickets, zero findings) emits.

Interactive mode only.

---

## Entry

The walk-through receives, from the orchestrator:

- The merged findings list in severity order (P0 → P1 → P2 → P3), filtered to `gated_auto` and `manual` findings that survived the Stage 5 anchor gate (anchor 75+, with P0 escape at anchor 50). Advisory findings are included when they were surfaced to this phase (advisory findings normally live in the report-only queue, but when the review flow routes them here for acknowledgment they take the advisory variant below).
- The cached tracker-detection tuple from `tracker-defer.md` (`{ tracker_name, confidence, named_sink_available, any_sink_available }`). `any_sink_available` determines whether the Defer option is offered; `named_sink_available` + `confidence` determine whether the label names the tracker inline.
- The run id for artifact lookups.

Each finding's recommended action has already been normalized by Stage 5 (step 7b — tie-break on action). The walk-through surfaces that recommendation to the user but does not recompute it.

---

## Per-finding presentation

Each finding is presented in two parts: a **terminal output block** carrying the explanation, and a **question** via the platform's blocking question tool (`AskUserQuestion` in Claude Code, `request_user_input` in Codex, `ask_user` in Gemini, `ask_user` in Pi (requires the `pi-ask-user` extension)) carrying the decision. Never merge the two — the terminal block uses markdown; the question uses plain text.

In Claude Code the tool should already be loaded from the Interactive-mode pre-load step in `SKILL.md` — if it isn't, call `ToolSearch` with query `select:AskUserQuestion` now. Fall back to presenting the per-finding options as a numbered list only when the harness genuinely lacks a blocking tool — `ToolSearch` returns no match, the tool call explicitly fails, or the runtime mode does not expose it (e.g., Codex edit modes without `request_user_input`). A pending schema load is not a fallback trigger. Never silently skip the question.

### Terminal output block (print before firing the question)

Render as markdown. Labels on their own line, blank lines between sections:

```
## Finding {N} of {M} — {severity} {plain-English title}

{file}:{line}

**What's wrong**

{plain-English problem statement from why_it_matters}

**Proposed fix**

{suggested_fix — rendered per the substitution rules below: prose-first, intent-language}

**Why it works**

{short reasoning, grounded in a codebase pattern when available}

{R15 conflict context line, when applicable}
```

Substitutions:

- **`{plain-English title}`:** a 3-8 word summary suitable as a heading. Derived from the merged finding's `title` field but rephrased so it reads as observable behavior (e.g., "Path traversal in loadUserFromCache" rather than "Missing userId validation on line 36").
- **`why_it_matters`:** read the contributing reviewer's artifact file at `/tmp/compound-engineering/ce-code-review/{run_id}/{reviewer_name}.json` using the same `file + line_bucket(line, +/-3) + normalize(title)` matching that headless mode uses (see `SKILL.md` Stage 6 detail enrichment). When multiple reviewers flagged the merged finding, try them in the order they appear in the merged finding's reviewer list. Use the first match.
- **`suggested_fix`:** from the merged finding's `suggested_fix` field. Render as prose describing **intent**, not as syntax. The fixer subagent owns the exact code — the walk-through just needs enough for the user to trust or reject the action. Rules:
  - **Default — one sentence describing the effect.** What does the fix achieve, and where does it live? Prefer intent language over quoted code.
    - ✅ `Throw on non-2xx response before parsing JSON.`
    - ✅ `` Replace `==` with `===` on line 42. ``
    - ✅ `` Add a `response.ok` check after the fetch and throw on non-2xx. ``
    - ✅ `Extract the request-building logic into a helper and call it from both sites.`
    - ❌ `` Add `if (!response.ok) throw new Error(`HTTP ${response.status}`);` after the `await fetch(...)` call, before `response.json()`. `` — nested backticks, multiple code spans, full statement quoted; renders broken in terminal.
  - **Code-span budget: at most 2 inline backtick spans per sentence, each a single identifier, operator, or short phrase** (e.g., `` `response.ok` ``, `` `===` ``, `` `fetchUserById` ``). Never embed full statements, template literals, or code requiring nested backticks. If the intent can't be stated within that budget, the prose is too close to syntax — restate at a higher level, or switch to summary + artifact pointer.
  - **Always leave a space before and after every backtick span.** Without it, the terminal's markdown renderer eats the delimiters and runs the words together.
  - **Raw code block — only for short (≤5 line) genuinely additive new code** where no before-state exists (new file, new function, new guard at the top of an empty body). Above 5 lines, switch to summary + pointer.
  - **Summary + artifact pointer** — when prose can't capture the fix: one-sentence transformation + key symbol/location + `Full fix: /tmp/compound-engineering/ce-code-review/{run_id}/{reviewer_name}.json → findings[].suggested_fix`.
  - **No diff blocks.** Modifications to existing code render as prose.
- **`Why it works`:** grounded reasoning that, where possible, references a similar pattern already used elsewhere in the codebase (e.g., "matches the format-validation pattern already used at src/cli/io.ts:41"). One to three sentences.
- **R15 conflict context line (when applicable):** when contributing reviewers implied different actions for this finding and Stage 5 step 7b broke the tie, surface that briefly. Example: `Correctness recommends Apply; Testing recommends Skip (low confidence). Agent's recommendation: Skip.` The orchestrator's recommendation — the post-tie-break value — is what the menu labels "recommended."

When no artifact match exists for the finding (merge-synthesized finding, or the persona's artifact write failed), the terminal block degrades to the heading + `suggested_fix` only (omit the `What's wrong` and `Why it works` sections) and records the gap for the Coverage section of the completion report.

### Question stem (short, decision-focused)

After the terminal block renders, fire the platform's blocking question tool with a compact two-line stem:

```
Finding {N} of {M} — {severity} {short handle}.
{Action framing in a phrase}?
```

Where:

- **Short handle:** matches the `{plain-English title}` from the terminal block heading.
- **Action framing:** one phrase describing what the *single recommended action* does, as a yes/no question. Examples: `Apply the format-validation + path.resolve guard?`, `Skip the fix since the fixture is being deleted?`, `Defer and file a rotation ticket?`.

Never enumerate alternatives in the stem. One recommendation as a yes/no — the option list carries the alternatives. When the recommendation is close, surface the disagreement in the R15 conflict context line, not as a multi-option stem.

Example (recommendation = Apply):

```
Finding 3 of 8 — P1 path traversal in loadUserFromCache.
Apply the format-validation + path.resolve guard?
```

Example (recommendation = Skip because content context overrides default):

```
Finding 1 of 9 — P0 hardcoded admin token.
Skip the fix since the fixture is being deleted?
(Security recommends Apply; file context recommends Skip. Agent's recommendation: Skip.)
```

Never embed code blocks, diff syntax, or the full fix/reasoning in the stem.

### Confirmation between findings

After the user answers and before printing the next finding's terminal block, emit a one-line confirmation of the action taken. Examples: `→ Applied. Fix staged at src/utils/api-client.ts:36-37.`, `→ Deferred. Ticket filed: <url>.`, `→ Skipped.`, `→ Acknowledged.`

### Options (four, or adapted as noted)

Fixed order. Never reorder:

```
1. Apply the proposed fix
2. Defer — file a [TRACKER] ticket
3. Skip — don't apply, don't track
4. Auto-resolve with best judgment on the rest
```

Render the `[TRACKER]` label per `tracker-defer.md`: when `confidence = high` AND `named_sink_available = true`, replace `[TRACKER]` with the concrete tracker name (e.g., `Defer — file a Linear ticket`). When `any_sink_available = true` but either `confidence = low` or `named_sink_available = false`, use the generic whole label `Defer — file a ticket` — whole-label substitution, not a `[TRACKER]` token swap.

**Mark the post-tie-break recommendation with `(recommended)` on its option label.** Required, not optional. Any of the four options can carry it:

```
1. Apply the proposed fix  (recommended)
2. Defer — file a ticket
3. Skip — don't apply, don't track
4. Auto-resolve with best judgment on the rest
```

```
1. Apply the proposed fix
2. Defer — file a ticket
3. Skip — don't apply, don't track  (recommended)
4. Auto-resolve with best judgment on the rest
```

When reviewers disagreed or content context cuts against the default, still mark one option — whichever Stage 5 step 7b produced — and surface the disagreement in the R15 conflict context line.

### Adaptations

- **No `suggested_fix` (Apply suppressed):** when the finding has no concrete `suggested_fix` (`gated_auto` or `manual` with `suggested_fix == null`), option A (`Apply`) is **omitted from the menu**. Stage 5 step 6b already maps these to a `Defer` recommendation, so the `(recommended)` marker lands on a still-visible option. The menu shows three options: `Defer` / `Skip` / `Auto-resolve with best judgment on the rest` (and reduces to `Skip` / `Auto-resolve with best judgment on the rest` when combined with the no-sink adaptation). When this combines with the advisory variant, the same suppression is moot because option A is already replaced with `Acknowledge`. This rule mirrors the suppression applied during `SKILL.md` Step 2 Interactive option B's post-run `Walk through these one at a time` re-entry, so the same handling applies regardless of which entry path the user came in through.
- **Advisory-only finding:** when the finding's `autofix_class` is `advisory` (no actionable fix), option A is replaced with `Acknowledge — mark as reviewed`. The other three options remain. The advisory variant is the only case where `Acknowledge` appears in the menu.
- **N=1 (exactly one pending finding):** the terminal block's heading omits `Finding N of M` and renders as `## {severity} {plain-English title}`. The stem's first line drops the position counter, becoming `{severity} {short handle}.` Option D (`Auto-resolve with best judgment on the rest`) is suppressed because no subsequent findings exist — the menu shows three options: Apply / Defer / Skip (or Acknowledge, for advisory).
- **No sink (Defer option unavailable):** when the tracker-detection tuple reports `any_sink_available: false` (every tier in the fallback chain — named tracker and GitHub Issues via `gh` — is unreachable), option B (`Defer`) is omitted. The stem appends one line explaining that no issue tracker is configured for this checkout (Linear, GitHub Issues, etc., were probed and unavailable). Phrase it for a developer audience — avoid `tracker sink` jargon, and avoid `platform` since the missing piece is per-project, not per-agent-platform. The menu shows three options: Apply / Skip / Auto-resolve with best judgment on the rest (and Acknowledge in place of Apply for advisory-only findings). **Before rendering the options, remap any per-finding `Defer` recommendation produced by Stage 5 step 7b to `Skip`** so the `(recommended)` marker always lands on an option that is actually in the menu. When the remap fires, surface it on the R15 conflict context line — name what was downgraded and why (so the reader sees the cross-reviewer Defer recommendation hasn't silently disappeared). This is a render-time runtime step; Stage 5 step 7b has no knowledge of sink availability and only orders conflicting reviewer recommendations.
- **Combined N=1 + no sink:** the menu shows two options: Apply / Skip (or Acknowledge / Skip).

Only when `ToolSearch` explicitly returns no match or the tool call errors — or on a platform with no blocking question tool — fall back to presenting the options as a numbered list and waiting for the user's next reply.

---

## Per-finding routing

For each finding's answer:

- **Apply the proposed fix** — add the finding's id to an in-memory Apply set. Advance to the next finding. Do not dispatch the fixer inline — Apply accumulates for end-of-walk-through batch dispatch.
- **Acknowledge — mark as reviewed** (advisory variant) — record Acknowledge in the in-memory decision list. Advance to the next finding. No side effects.
- **Defer — file a [TRACKER] ticket** — invoke the tracker-defer flow from `tracker-defer.md`. The walk-through's position indicator stays on the current finding during any failure-path sub-question (Retry / Fall back / Convert to Skip). On success, record the tracker URL / reference in the in-memory decision list and advance. On conversion-to-Skip from the failure path, advance with the failure noted in the completion report.
- **Skip — don't apply, don't track** — record Skip in the in-memory decision list. Advance. No side effects.
- **Auto-resolve with best judgment on the rest** — exit the walk-through loop and dispatch the fixer subagent (`SKILL.md` Step 3) immediately on the remaining action set: the current finding plus everything not yet decided. No Stage 5b pre-pass. No bulk-preview approval gate. The fixer applies items with concrete `suggested_fix`, no-ops on advisory items, and routes items where the fix cannot be applied cleanly (or where evidence no longer matches the code) to a `failed` bucket with a one-line reason. Apply findings the user already picked during the walk-through are dispatched in the same fixer pass — the remaining set joins the in-memory Apply set so the fixer receives the union and applies all changes against a consistent tree. After the fixer returns, follow the post-run failure-handling logic in `SKILL.md` Step 2 Interactive option B — when the `failed` bucket is non-empty, fire one question with three options (file tickets / walk through / ignore). When the `failed` bucket is empty, emit the unified completion report directly.

---

## Override rule

"Override" means the user picks a different preset action (Defer or Skip in place of Apply, or Apply in place of the agent's recommendation). No inline freeform custom-fix authoring — the walk-through is a decision loop, not a pair-programming surface. A user who wants a variant of the proposed fix picks Skip and hand-edits outside the flow; if they also want the finding tracked, they file a ticket manually. This trade is explicit in v1's scope boundaries.

---

## State

Walk-through state is **in-memory only**. The orchestrator maintains:

- An Apply set (finding ids the user picked Apply on)
- A decision list (every answered finding with its action and any metadata like `tracker_url` for Deferred or `reason` for Skipped)
- The current position in the findings list

Nothing is written to disk per-decision. An interrupted walk-through (user cancels the prompt, session compacts, network dies) discards all in-memory state. Defer actions that already executed remain in the tracker — those are external side effects and cannot be rolled back. Apply decisions have not been dispatched yet (they batch at end-of-walk-through), so they are cleanly lost with no code changes.

Formal cross-session resumption is out of scope for v1.

---

## End-of-walk-through dispatch

This section covers the run-to-completion path only — every finding has been answered Apply / Defer / Skip / Acknowledge and the loop ended naturally. The `Auto-resolve with best judgment on the rest` path exits the walk-through earlier and dispatches its own fixer pass on the union of (accumulated Apply set ∪ remaining undecided findings); see that bullet under "Per-finding routing" above. There is no second dispatch in that branch.

When the loop runs to completion, the walk-through hands off to the dispatch phase:

1. **Apply set:** spawn one fixer subagent for the full accumulated Apply set. The fixer receives the set as its input queue and applies all changes in one pass against the current working tree. This preserves the existing "one fixer, consistent tree" mechanic and gives the fixer the full set at once to handle inter-fix dependencies (two Applies touching overlapping regions). The existing Step 3 fixer prompt needs a small update to acknowledge this queue may be heterogeneous (`gated_auto` and `manual` mix, not just `safe_auto`) — authored alongside this reference.
2. **Defer set:** already executed inline during the walk-through. Nothing to dispatch here.
3. **Skip / Acknowledge:** no-op.

After dispatch completes, emit the unified completion report described below.

---

## Unified completion report

Every terminal path of Interactive mode emits the same completion report structure. This covers:

- Walk-through completed (all findings answered)
- Walk-through bailed via `Auto-resolve with best judgment on the rest`
- Top-level best-judgment (routing option B) completed
- Top-level File tickets (routing option C) completed
- Zero findings after `safe_auto` (routing question was skipped — the completion summary is a one-line degenerate case of this structure)

### Minimum required fields (per R12)

- **Per-finding entries:** for every finding the flow touched, a line with — at minimum — title, severity, the action taken (Applied / Deferred / Skipped / Acknowledged), the tracker URL or in-session task reference for Deferred entries, and a one-line reason for Skipped entries (grounded in the finding's confidence or the one-line `why_it_matters` snippet).
- **Summary counts by action:** totals per bucket (e.g., `4 applied, 2 deferred, 2 skipped`).
- **Failures called out explicitly:** any fix application that failed, any ticket creation that failed (with the reason returned by the tracker). Failures are surfaced above the per-finding list so they are not missed.
- **End-of-review verdict:** the existing Stage 6 verdict (Ready to merge / Ready with fixes / Not ready), computed from the residual state after all actions complete.

### Coverage section

Carry forward the existing Coverage data (suppressed-finding count, residual risks, testing gaps, failed reviewers) and add one new element:

- **Framing-enrichment gaps:** count of findings where artifact lookup returned no match (merge-synthesized findings, or failed persona artifact writes). Name the personas contributing those gaps so the data feeds any future persona-upgrade decision. A trail of gaps per run tells the team which persona agents still need attention.

### Report ordering

The report appears after all execution completes. Ordering inside the report: failures first (above the per-finding list), then per-finding entries grouped by action bucket in the order `Applied / Deferred / Skipped / Acknowledged`, then summary counts, then Coverage, then the verdict.

### Zero-findings degenerate case

When the routing question was skipped because no `gated_auto` / `manual` findings remained after `safe_auto`, the completion report collapses to its summary-counts + verdict form with one added line — the count of `safe_auto` fixes applied. The summary wording mirrors `SKILL.md` Step 2 Interactive mode's zero-remaining case: the unqualified `All findings resolved` form is only accurate when no advisory or pre-existing findings remain. When advisory and/or pre-existing findings remain in the report, use the qualified form that names what was cleared and names what still remains. Examples:

No remaining advisory or pre-existing findings:

```
All findings resolved — 3 safe_auto fixes applied.

Verdict: Ready with fixes.
```

Advisory and/or pre-existing findings remain in the report:

```
All actionable findings resolved — 3 safe_auto fixes applied. (2 advisory, 1 pre-existing findings remain in the report.)

Verdict: Ready with fixes.
```

---

## Execution posture

The walk-through is operationally read-only except for two permitted writes: the in-memory Apply set / decision list (managed by the orchestrator) and the tracker-defer dispatch (external ticket creation, described in `tracker-defer.md`). Persona agents remain strictly read-only. The end-of-walk-through fixer dispatch is the single point where file modifications happen — governed by the existing Step 3 fixer contract in `SKILL.md`.
