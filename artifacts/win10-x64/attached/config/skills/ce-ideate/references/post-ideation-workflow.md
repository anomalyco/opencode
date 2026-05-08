# Post-Ideation Workflow

Read this file after Phase 2 ideation agents return and the orchestrator has merged and deduped their outputs into a master candidate list. Do not load before Phase 2 completes.

## Phase 3: Adversarial Filtering

Review every candidate idea critically. The orchestrator performs this filtering directly -- do not dispatch sub-agents for critique.

Do not generate replacement ideas in this phase unless explicitly refining.

For each rejected idea, write a one-line reason.

Rejection criteria:
- too vague
- not actionable
- duplicates a stronger idea
- not grounded in the stated context
- too expensive relative to likely value
- already covered by existing workflows or docs
- interesting but better handled as a brainstorm variant, not a product improvement
- **unjustified — no articulated warrant** (sub-agent failed to provide `direct:`, `external:`, or `reasoned:` justification, or the stated warrant does not actually support the claimed move)
- **below ambition floor** (fails the meeting-test: would not warrant team discussion — except when Phase 0.5 detected tactical focus signals, in which case this criterion is waived)
- **subject-replacement** (abandons or replaces the subject of ideation rather than operating on it — e.g., "pivot to an unrelated domain," "become a different organization")

Score survivors using a consistent rubric weighing: groundedness in stated context, **warrant strength** (`direct:` > `external:` > `reasoned:`; none excluded, but direct-evidence ideas score higher all else equal), expected value, novelty, pragmatism, leverage on future work, implementation burden, and overlap with stronger ideas.

Target output:
- keep 5-7 survivors by default
- if too many survive, run a second stricter pass
- if fewer than 5 survive, report that honestly rather than lowering the bar

## Phase 4: Present the Survivors

**Checkpoint B (V17).** Before presenting, write `<scratch-dir>/survivors.md` (using the absolute path captured in Phase 1) containing the survivor list plus key context (focus hint, grounding summary, rejection summary). This protects the post-critique state before the user reaches the persistence menu. Best-effort: if the write fails (disk full, permissions), log a warning and proceed; the checkpoint is not load-bearing. Reuses the same `<run-id>` and `<scratch-dir>` generated in Phase 1; not cleaned up at the end of the run (the run directory is preserved so the V15 cache remains reusable across run-ids in the same session — see Phase 6).

Present the surviving ideas to the user. The terminal review loop is a complete ideation cycle in itself — persistence is opt-in (Phase 5), and refinement happens in conversation with no file or network cost (Phase 6).

Present only the surviving ideas in structured form:

- title
- description
- **warrant** (tagged `direct:` / `external:` / `reasoned:`, with the quoted evidence, cited source, or written-out argument)
- rationale (how the warrant connects to the move's significance)
- downsides
- confidence score
- estimated complexity

Then include a brief rejection summary so the user can see what was considered and cut.

Keep the presentation concise. Allow brief follow-up questions and lightweight clarification.

## Phase 5: Persistence (Opt-In, Mode-Aware)

Persistence is opt-in. The terminal review loop is a complete ideation cycle. Refinement loops happen in conversation with no file or network cost. Persistence triggers only when the user explicitly chooses to save, share, or hand off (selected in Phase 6).

When the user picks an option in Phase 6 that requires a durable record (Open and iterate in Proof, Brainstorm, Save and end), ensure a record exists first. When the user chooses to keep refining, no record is needed unless the user asks.

**Mode-determined defaults:**

| Action | Repo mode default | Elsewhere mode default |
|---|---|---|
| Save | `docs/ideation/YYYY-MM-DD-<topic>-ideation.md` | Proof |
| Share | Proof (additional) | Proof (primary) |
| Brainstorm handoff | `ce-brainstorm` | `ce-brainstorm` (universal-brainstorming) |
| End | Conversation only is fine | Conversation only is fine |

Either mode can also use the other destination on explicit request ("save to Proof even though this is repo mode", "save to a local file even though this is elsewhere"). Honor such overrides directly.

### 5.1 File Save (default for repo mode; on request for elsewhere mode)

1. Ensure `docs/ideation/` exists
2. Choose the file path:
   - `docs/ideation/YYYY-MM-DD-<topic>-ideation.md`
   - `docs/ideation/YYYY-MM-DD-open-ideation.md` when no focus exists
3. Write or update the ideation document

Use this structure and omit clearly irrelevant fields only when necessary:

```markdown
---
date: YYYY-MM-DD
topic: <kebab-case-topic>
focus: <optional focus hint>
mode: <repo-grounded | elsewhere-software | elsewhere-non-software>
---

# Ideation: <Title>

## Grounding Context
[Grounding summary from Phase 1 — labeled "Codebase Context" in repo mode, "Topic Context" in elsewhere mode]

## Ranked Ideas

### 1. <Idea Title>
**Description:** [Concrete explanation]
**Warrant:** [`direct:` / `external:` / `reasoned:` — the actual basis, quoted or cited]
**Rationale:** [How the warrant connects to the move's significance]
**Downsides:** [Tradeoffs or costs]
**Confidence:** [0-100%]
**Complexity:** [Low / Medium / High]
**Status:** [Unexplored / Explored]

## Rejection Summary

| # | Idea | Reason Rejected |
|---|------|-----------------|
| 1 | <Idea> | <Reason rejected> |
```

If resuming:
- update the existing file in place
- preserve explored markers

### 5.2 Proof Save (default for elsewhere mode; on request for repo mode)

Hand off the ideation content to the `ce-proof` skill in HITL review mode. This uploads the doc, runs an iterative review loop (user annotates in Proof, agent ingests feedback and applies tracked edits), and (in repo mode) syncs the reviewed markdown back to `docs/ideation/`.

Load the `ce-proof` skill in HITL-review mode with:

- **source content:** the survivors and rejection summary from Phase 4 (in repo mode, this is the file written in 5.1; in elsewhere mode, render to a temp file as the source for upload)
- **doc title:** `Ideation: <topic>` or the H1 of the ideation doc
- **identity:** `ai:compound-engineering` / `Compound Engineering`
- **recommended next step:** `/ce-brainstorm` (shown in the proof skill's final terminal output)

The Proof failure ladder in Phase 6.5 governs what happens when this hand-off fails.

**Caller-aware return.** The return-rule bullets below describe the default control flow, but the next step depends on which Phase 6 option invoked the Proof save. Apply the right branch for the caller:

- **§6.2 Open and iterate in Proof.** Behavior is mode-aware:
    - *Repo mode:* return to the Phase 6 menu on every status. The Proof-reviewed content is now synced locally, and the user typically has a follow-up action in the repo (brainstorm toward a plan, save and end, or keep refining).
    - *Elsewhere mode:* on a successful Proof return (`proceeded` or `done_for_now`), exit cleanly — narrate that the artifact lives at `docUrl` (including any stale-local note if applicable) and stop. Proof iteration is often the terminal act in elsewhere mode; forcing another menu choice after the user already got what they came for produces decision fatigue. Only the `aborted` branch returns to the Phase 6 menu so the user can retry or pick another path.
- **§6.3 Brainstorm a selected idea.** On a successful Proof return (`proceeded` or `done_for_now`), do **not** stop at the Phase 6 menu — after applying the per-status handling below (including any stale-local pull offer), continue into §6.3's remaining bullets (mark the chosen idea as `Explored`, then load `ce-brainstorm`). Only the `aborted` branch returns to the Phase 6 menu, since no durable record was written.
- **§6.4 Save and end.** On a successful Proof return (`proceeded` or `done_for_now`), exit cleanly: narrate that the ideation was saved, surface the `docUrl` (and the local-path note if applicable), and stop. Do **not** re-ask the Phase 6 question — the user already chose to end. Only the `aborted` branch returns to the Phase 6 menu so the user can retry or pick a different path.

When the proof skill returns control:

- `status: proceeded` with `localSynced: true` → the ideation doc on disk now reflects the review. Apply the caller-aware return rule above for the invoking branch.
- `status: proceeded` with `localSynced: false` → the reviewed version lives in Proof at `docUrl` but the local copy is stale. Offer to pull the Proof doc to `localPath` using the proof skill's Pull workflow. Apply the caller-aware return rule above; if the pull was declined, include a one-line note that `<localPath>` is stale vs. Proof so the next handoff (or final exit narration) doesn't read the old content silently. Placement: above the Phase 6 menu when the caller-aware rule returns to it, in the handoff preamble to `ce-brainstorm` for §6.3, or alongside the final save/exit narration for §6.2 elsewhere / §6.4.
- `status: done_for_now` → the doc on disk may be stale if the user edited in Proof before leaving. Offer to pull the Proof doc to `localPath` so the local ideation artifact stays in sync, then apply the caller-aware return rule above. `done_for_now` means the user stopped the HITL loop — it does not mean they ended the whole ideation session unless the caller-aware rule exits (§6.2 elsewhere mode or §6.4). If the pull was declined, include the stale-local note at the placement described in the previous bullet.
- `status: aborted` → fall back to the Phase 6 menu without changes, regardless of caller. No durable record was written, so §6.3 must not proceed with the brainstorm handoff and §6.4 must not end — the menu lets the user retry or pick another path.

## Phase 6: Refine or Hand Off

Ask what should happen next using the platform's blocking question tool: `AskUserQuestion` in Claude Code (call `ToolSearch` with `select:AskUserQuestion` first if its schema isn't loaded), `request_user_input` in Codex, `ask_user` in Gemini, `ask_user` in Pi (requires the `pi-ask-user` extension). Fall back to numbered options in chat only when no blocking tool exists in the harness or the call errors (e.g., Codex edit modes) — not because a schema load is required. Never silently skip the question.

**Question:** "What should the agent do next?"

Offer these four options (labels are self-contained with the distinguishing word front-loaded so options stay distinct when truncated):

1. **Refine the ideation in conversation (or stop here — no save)** — add ideas, re-evaluate, or deepen analysis. No file or network side effects; ending the conversation at any point after this pick is a valid no-save exit.
2. **Open and iterate in Proof** — save the ideation to Proof and enter the proof skill's HITL review loop: iterate via comments in the Proof editor; reviewed edits sync back to `docs/ideation/` in repo mode.
3. **Brainstorm a selected idea** — load `ce-brainstorm` with the chosen idea as the seed. The orchestrator first writes a durable record using the mode default in Phase 5.
4. **Save and end** — persist the ideation using the mode default (file in repo mode, Proof in elsewhere mode), then end.

No-save exit is supported without a dedicated menu option. Pick option 1 and stop the conversation, or use the question tool's free-text escape to say so directly — persistence is opt-in and the terminal review loop is already a complete ideation cycle.

Do not delete the run's scratch directory (`<scratch-dir>` resolved in Phase 1) on completion. The V15 web-research cache is session-scoped and reused across run-ids by later ideation invocations in the same session (see `references/web-research-cache.md`); per-run cleanup would defeat that reuse. Checkpoint A (`raw-candidates.md`) and Checkpoint B (`survivors.md`) are cheap to leave behind and follow the repo's Scratch Space cross-invocation-reusable convention — OS handles eventual cleanup.

### 6.1 Refine the Ideation in Conversation

Route refinement by intent:

- `add more ideas` or `explore new angles` -> return to Phase 2
- `re-evaluate` or `raise the bar` -> return to Phase 3
- `dig deeper on idea #N` -> expand only that idea's analysis

No persistence triggers during refinement. The user can choose Save and end (or Brainstorm, or Open and iterate in Proof) when they are ready to persist.

Ending after refinement — or without any refinement at all — is a valid no-save exit. There is no required next step; stopping the conversation here leaves no durable artifact, which matches the opt-in persistence contract.

### 6.2 Open and Iterate in Proof

Invoke the Proof HITL review path via §5.2 with §6.2 as the caller. In repo mode, ensure the local file exists first (run §5.1) so the HITL sync-back has a target; in elsewhere mode, §5.2 renders to a temp file as usual. Honor Phase 5's "ensure a record exists first" contract either way.

Apply §5.2's caller-aware return rule for the §6.2 branch — behavior is mode-aware. In repo mode, return to the Phase 6 menu on every status so the user can pick a follow-up (brainstorm toward a plan, save-and-end, or keep refining) now that the Proof review is reflected in the local file. In elsewhere mode, exit cleanly on a successful Proof return since Proof iteration is often the terminal act — the artifact lives at `docUrl` and is the canonical record; only the `aborted` status returns to the menu.

If the Proof handoff fails, the §6.5 Proof Failure Ladder governs recovery.

### 6.3 Brainstorm a Selected Idea

- Write or update the durable record per the mode default in Phase 5 (file in repo mode, Proof in elsewhere mode). When this routes through §5.2 Proof Save, apply §5.2's caller-aware return rule: continue into the next bullet on a successful Proof return instead of bouncing back to the Phase 6 menu. If Proof returned `aborted` (no durable record written), go back to the Phase 6 menu and do **not** proceed with the brainstorm handoff.
- Mark the chosen idea as `Explored` in the saved record
- Load the `ce-brainstorm` skill with the chosen idea as the seed

**Repo mode only:** do **not** skip brainstorming and go straight to `ce-plan` from ideation output — `ce-plan` wants brainstorm-grounded requirements. In elsewhere modes, ideation (or ideation + Proof iteration) is a legitimate terminal state; brainstorming is optional deeper development of one idea, not a required next rung on an implementation ladder that does not exist in these modes.

### 6.4 Save and End

Persist via the mode default (5.1 in repo mode, 5.2 in elsewhere mode), then end. If the user instead asked to use the non-default destination, honor that explicit request.

When the path lands in a Proof save (5.2), apply §5.2's caller-aware return rule for the §6.4 branch: on a successful Proof return, exit cleanly — narrate the save, surface the `docUrl` (and any stale-local note if the pull was declined), and stop. Do **not** loop back to the Phase 6 menu; the user already chose to end. Only a `status: aborted` from Proof returns to the menu so the user can retry or pick another path (file save, custom path, or keep refining). The §6.5 Proof Failure Ladder still governs persistent Proof failures and ends at the Phase 6 menu — that failure-recovery path is distinct from the successful-save exit described here.

When the path lands in a file save (5.1):

- offer to commit only the ideation doc
- do not create a branch
- do not push
- if the user declines, leave the file uncommitted

After the file save (and optional commit), end the session — do not return to the Phase 6 menu.

### 6.5 Proof Failure Ladder

The `ce-proof` skill performs single-retry-once internally on transient failures (`STALE_BASE`, `BASE_TOKEN_REQUIRED`) before surfacing failure. The proof skill's return contract does not expose typed error classes to callers — the orchestrator cannot distinguish retryable vs terminal failures from outside.

**Orchestrator-side retry harness (intentionally minimal):** wrap the proof skill invocation in **one** additional best-effort retry with a short pause (~2 seconds). The proof skill already retried internally, so this catches transient races at the orchestrator boundary without compounding latency. Do not classify error types from outside the skill — no detection mechanism exists.

Distinguish create-failure from ops-failure by inspecting whether the proof skill returned a `docUrl` before failing:

- **Create-failure** (no `docUrl` returned): retry the create.
- **Ops-failure** (a `docUrl` was returned, but a later operation failed): retry only the failing operation. **Do not recreate** the document.

**Failure narration.** Narrate the single retry to the terminal so the pause does not look like a hang ("Retrying Proof... attempt 2/2"). On persistent failure, narrate that retry exhausted before showing the fallback menu.

**Fallback menu after persistent failure.** Use the platform's blocking question tool. Present these options (omit option (a) if no repo exists at CWD):

- "Save to `docs/ideation/` instead" (repo-mode default destination, available when CWD is inside a git repo)
- "Save to a custom path the user provides" (validate writable; create parent dirs)
- "Skip save and keep the ideation in conversation" (no persistence)

If proof returned a partial `docUrl` before failing, surface that URL alongside the fallback options so the user can recover or share the partial record.

After the fallback completes (any path), continue back to the Phase 6 menu so the user can still refine, iterate in Proof, brainstorm, or save and end.

## Quality Bar

Before finishing, check:

- the idea set is grounded in the stated context (codebase in repo mode; user-supplied context in elsewhere mode)
- **every surviving idea has articulated warrant** (`direct:`, `external:`, or `reasoned:`) that actually supports the claimed move — speculation dressed as ambition was rejected, with reasons
- **every surviving idea passes the meeting-test** unless Phase 0.5 detected tactical focus signals that waived the floor
- **no surviving idea replaces the subject** rather than operating on it
- the candidate list was generated before filtering
- the original many-ideas -> critique -> survivors mechanism was preserved
- if sub-agents were used, they improved diversity without replacing the core workflow
- every rejected idea has a reason
- survivors are materially better than a naive "give me ideas" list
- persistence followed user choice — terminal-only sessions did not write a file or call Proof
- when persistence did trigger, the mode default was respected unless the user explicitly overrode it
- acting on an idea routes to `ce-brainstorm`, not directly to implementation
