# Bulk Action Preview

This reference defines the compact plan preview that Interactive mode shows before the file-tickets routing option (option C) executes. The preview gives the user a single-screen view of what the agent is about to do, with exactly two options to Proceed or Cancel.

Interactive mode only. Option C only.

The best-judgment path (routing option B and the walk-through's `Auto-resolve with best judgment on the rest`) does **not** use the bulk preview. The best-judgment path dispatches the fixer immediately and surfaces failures in a post-run question, per the `(B)` handler in `SKILL.md` Step 2 Interactive mode. Filing tickets is the one bulk action that benefits from a preview because filing produces durable external state that is expensive to undo — applying local fixes on uncommitted edits is not.

---

## When the preview fires

One call site:

- **Routing option C (top-level File tickets)** — after the user picks `File a [TRACKER] ticket per finding without applying fixes` but before any ticket is filed. Scope: every pending `gated_auto` / `manual` finding. Every finding appears under `Filing [TRACKER] tickets (N):` regardless of the agent's natural recommendation, because option C is batch-defer.

The user confirms with `Proceed` or backs out with `Cancel`. No per-item decisions inside the preview — per-item decisioning is the walk-through's role (option A).

---

## Preview structure

The preview is grouped by the action the agent intends to take. Bucket headers appear only when their bucket is non-empty.

```
<Path label> — <scope summary>[ (tracker: <name>)]:

Applying (N):
  [P0] <file>:<line> — <one-line plain-English summary>
  [P1] <file>:<line> — <one-line plain-English summary>

Filing [TRACKER] tickets (N):
  [P2] <file>:<line> — <one-line plain-English summary>

Skipping (N):
  [P2] <file>:<line> — <one-line plain-English summary>

Acknowledging (N):
  [P3] <file>:<line> — <one-line plain-English summary>
```

Worked example, for routing option C (file tickets):

```
File plan — 8 findings as Linear tickets:

Filing Linear tickets (8):
  [P0] orders_controller.rb:42 — Missing ownership guard on order lookup
  [P1] webhook_handler.rb:120 — Unhandled error swallowed in webhook
  [P2] user_serializer.rb:14 — internal_id leaks in serialized response
  [P2] billing_service.rb:230 — N+1 on refund batch
  [P2] session_helper.rb:12 — Session reset behavior unclear
  [P2] report_worker.rb:55 — Worker timeout under heavy load
  [P3] string_utils.rb:8 — Ambiguous helper name
  [P3] readme.md:14 — Documentation gap
```

---

## Scope summary wording

- **Routing option C (top-level File tickets):** header reads `File plan — N findings as [TRACKER] tickets:`. Every finding lands in the `Filing [TRACKER] tickets (N):` bucket. Option C is batch-defer — no Apply / Skip / Acknowledge buckets render in the preview, since every finding is being filed.

When the detected tracker is low-confidence or generic (see `tracker-defer.md`), the `(tracker: <name>)` annotation is omitted from the header and the `Filing [TRACKER] tickets` bucket header uses the generic form (`Filing tickets (N):`).

---

## Per-finding line format

Each line uses the compressed form of the framing-quality bar from the plan (R22-R25 — observable-behavior-first, no function / variable names unless needed to locate). The one-line summary is drawn from the persona-produced `why_it_matters` by taking the first sentence (and, when the first sentence is too long for the preview width, paraphrasing it tightly to fit).

- **Shape:** `[<severity>] <file>:<line> — <one-line summary>`
- **Width target:** keep lines near 80 columns so the preview renders cleanly in narrow terminals. Truncate with ellipsis when necessary.
- **No function / variable names inline** unless the reader needs them to locate the issue.
- **Advisory bucket phrasing:** the `Acknowledging (N):` bucket describes the advisory content in one line. No "fix" phrase — advisory findings have no concrete fix.

When no `why_it_matters` is available for a finding (e.g., Unit 2's template upgrade hasn't fully propagated through the persona run, or the artifact file was unreadable), fall back to the finding's title directly. Note the gap in the completion report's Coverage section if it affects more than a few findings in the same run.

---

## Question and options

After the preview body is rendered, ask the user using the platform's blocking question tool (`AskUserQuestion` in Claude Code, `request_user_input` in Codex, `ask_user` in Gemini, `ask_user` in Pi (requires the `pi-ask-user` extension)). In Claude Code, the tool should already be loaded from the Interactive-mode pre-load step — if it isn't, call `ToolSearch` with query `select:AskUserQuestion` now. The text fallback below applies only when the harness genuinely lacks a blocking tool — `ToolSearch` returns no match, the tool call explicitly fails, or the runtime mode does not expose it (e.g., Codex edit modes without `request_user_input`). A pending schema load is not a fallback trigger. Never silently skip the question.

Stem: `The agent is about to file the tickets above. Proceed?`

Options (exactly two):
- `Proceed` — file every ticket in the preview
- `Cancel` — do nothing, return to the routing question

Only when `ToolSearch` explicitly returns no match or the tool call errors — or on a platform with no blocking question tool — fall back to presenting numbered options and waiting for the user's next reply.

---

## Cancel semantics

`Cancel` returns the user to the routing question (the four-option menu in `SKILL.md` Step 2 Interactive mode). No tickets are filed; no state is recorded. The session's cached tracker-detection tuple is preserved.

---

## Proceed semantics

When the user picks `Proceed`, every finding in the preview routes through `references/tracker-defer.md` for ticket creation. No fixes are applied. After all tickets have been filed (or failed), emit the unified completion report (see `references/walkthrough.md`).

Failure during `Proceed` (e.g., ticket creation fails for one finding during a batch Defer) follows the failure path defined in `tracker-defer.md` — surface the failure inline with Retry / Fallback / Skip, continue with the rest of the plan, and capture the failure in the completion report's failure section.

---

## Edge cases

- **N=1 preview (only one finding in scope):** the preview still renders with a single-line bucket. `Proceed` / `Cancel` still apply.
- **No tracker available:** option C is not offered upstream (see `tracker-defer.md` no sink handling). The bulk preview is therefore never invoked when `any_sink_available` is false.
