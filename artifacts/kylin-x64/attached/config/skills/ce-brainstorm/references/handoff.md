# Handoff

This content is loaded when Phase 4 begins — after the requirements document is written.

---

#### 4.1 Present Next-Step Options

The Phase 4 menu's visible option count varies by state: no requirements doc hides the review and Proof options, unresolved `Resolve Before Planning` hides `Plan implementation` and `Build it now`, a failing direct-to-work gate hides `Build it now`. Count the visible options for the current state and choose the rendering mode accordingly:

- **4 or fewer visible:** use the platform's blocking question tool (`AskUserQuestion` in Claude Code — call `ToolSearch` with `select:AskUserQuestion` first if its schema isn't loaded; `request_user_input` in Codex; `ask_user` in Gemini, `ask_user` in Pi (requires the `pi-ask-user` extension)). This is the default.
- **5 or more visible:** render as a numbered list in chat. This is the narrow option-overflow fallback; trimming would hide legitimate choices (plan, review, Proof, build, refine, pause are all distinct destinations). Include a hint that free-form input is accepted ("Pick a number or describe what you want.") so the numbered list retains the blocking tool's open-endedness.

Never silently skip the question.

If `Resolve Before Planning` contains any items:
- Ask the blocking questions now, one at a time, by default
- If the user explicitly wants to proceed anyway, first convert each remaining item into an explicit decision, assumption, or `Deferred to Planning` question
- If the user chooses to pause instead, present the handoff as paused or blocked rather than complete
- Do not offer the `Plan implementation` or `Build it now` options while `Resolve Before Planning` remains non-empty

In both preambles below, the "Pick a number or describe what you want." hint applies only in numbered-list mode. When using the blocking tool, omit that line and pass the remaining stem as the question.

**Path format:** Use absolute paths for chat-output file references — relative paths are not auto-linked as clickable in most terminals.

**Preamble when no blocking questions remain:**

```
Brainstorm complete.

Requirements doc: <absolute path to requirements doc>  # omit line if no doc was created

What would you like to do next? (Pick a number or describe what you want.)
```

**Preamble when blocking questions remain and user wants to pause:**

```
Brainstorm paused. Planning is blocked until the remaining questions are resolved.

Requirements doc: <absolute path to requirements doc>  # omit line if no doc was created

What would you like to do next? (Pick a number or describe what you want.)
```

Present only the options that apply. Renumber so visible options stay contiguous starting at 1.

1. **Plan implementation with `ce-plan` (Recommended)** - Move to `ce-plan` for structured implementation planning. Shown only when `Resolve Before Planning` is empty.
2. **Agent review of requirements doc with `ce-doc-review`** - Dispatch reviewer agents to check the doc for coherence, feasibility, scope, and other persona-specific issues; auto-apply safe fixes; route remaining findings interactively. Shown only when a requirements document exists.
3. **Open in Proof — review and comment to iterate with the agent** - Open the doc in Every's Proof editor, iterate with the agent via comments, or copy a link to share with others. Shown only when a requirements document exists.
4. **Build it now with `ce-work` (skip planning)** - Skip planning and move to `ce-work`; suited to lightweight, well-defined changes. Shown only when `Resolve Before Planning` is empty **and** scope is lightweight, success criteria are clear, scope boundaries are clear, and no meaningful technical or research questions remain (the "direct-to-work gate").
5. **More clarifying questions to sharpen the doc** - Keep refining scope, edge cases, constraints, and preferences through further dialogue. Always shown.
6. **Done for now** - Pause; the requirements doc is saved and can be resumed later. Always shown.

**Post-review nudge (subsequent rounds only):** If the user has already run `ce-doc-review` this session and residual P0/P1 findings remain unaddressed, add a one-line prose nudge adjacent to the menu (e.g., "Document review flagged 2 P1 findings you may want to address — pick \"Agent review of requirements doc\" to run another pass."). Reference the option by label, not number: the menu renumbers when `Resolve Before Planning` hides `Plan implementation` and `Build it now`, so a hardcoded option number can point users at the wrong action. Do not add a separate menu option; reuse the existing agent-review option.

#### 4.2 Handle the Selected Option

Selections may be the literal option label (when the user types the label or a close paraphrase) or the option number. Match numbers against the currently-rendered (post-trim) list. Free-form input that doesn't match an option or describe an alternative action should be treated as clarification — ask a follow-up rather than guessing.

**If user selects "Plan implementation with `ce-plan` (Recommended)":**

Immediately load the `ce-plan` skill in the current session. Pass the requirements document path when one exists; otherwise pass a concise summary of the finalized brainstorm decisions. Do not print the closing summary first.

**If user selects "Agent review of requirements doc with `ce-doc-review`":**

Load the `ce-doc-review` skill, passing the requirements document path as the argument. When ce-doc-review returns "Review complete", return to the Phase 4 options and re-render the menu (the doc may have changed, so re-evaluate `Resolve Before Planning`, direct-to-work gate, and residual findings). If residual P0/P1 findings remain unaddressed, include the post-review nudge above the menu. Do not show the closing summary yet.

**If user selects "Build it now with `ce-work` (skip planning)":**

Immediately load the `ce-work` skill in the current session using the finalized brainstorm output as context. If a compact requirements document exists, pass its path. Do not print the closing summary first.

**If user selects "More clarifying questions to sharpen the doc":** Return to Phase 1.3 (Collaborative Dialogue) and continue asking the user clarifying questions one at a time to further refine scope, edge cases, constraints, and preferences. Continue until the user is satisfied, then return to Phase 4. Do not show the closing summary yet.

**If user selects "Open in Proof — review and comment to iterate with the agent":**

Load the `ce-proof` skill in HITL-review mode with:

- **source file:** `docs/brainstorms/YYYY-MM-DD-<topic>-requirements.md`
- **doc title:** `Requirements: <topic title>`
- **identity:** `ai:compound-engineering` / `Compound Engineering`
- **recommended next step:** `ce-plan` (shown in the ce-proof skill's final terminal output)

Follow `references/hitl-review.md` in the ce-proof skill. It uploads the doc, prompts the user for review in Proof's web UI, ingests each thread by reading it fresh and replying in-thread, applies agreed edits as tracked suggestions, and syncs the final markdown back to the source file atomically on proceed.

When the ce-proof skill returns control:

- `status: proceeded` with `localSynced: true` → the requirements doc on disk now reflects the review. Return to the Phase 4 options and re-render the menu (the doc may have changed substantially during review, so option eligibility can shift — re-evaluate `Resolve Before Planning`, direct-to-work gate, and residual ce-doc-review findings against the updated doc).
- `status: proceeded` with `localSynced: false` → the reviewed version lives in Proof at `docUrl` but the local copy is stale. Offer to pull the Proof doc to `localPath` using the ce-proof skill's Pull workflow. Re-render the Phase 4 menu after the pull completes (or is declined). If the pull was declined, include a one-line note above the menu that `<localPath>` is stale vs. Proof — otherwise `Plan implementation` / `Build it now` / `Agent review of requirements doc` will silently read the pre-review copy (ce-doc-review would analyze stale content, and planning or work would skip the user's Proof edits).
- `status: done_for_now` → the doc on disk may be stale if the user edited in Proof before leaving. Offer to pull the Proof doc to `localPath` so the local requirements file stays in sync, then return to the Phase 4 options. If the pull was declined, include the stale-local note above the menu. `done_for_now` means the user stopped the HITL loop without syncing — it does not mean they ended the whole brainstorm; they may still want to plan implementation, run an agent review, or keep refining the doc.
- `status: aborted` → fall back to the Phase 4 options without changes.

If the initial upload fails (network error, Proof API down), retry once after a short wait. If it still fails, tell the user the upload didn't succeed and briefly explain why, then return to the Phase 4 options — don't leave them wondering why the option did nothing.

**If user selects "Done for now":** Display the closing summary (see 4.3) and end the turn.

#### 4.3 Closing Summary

Use the closing summary only when this run of the workflow is ending or handing off, not when returning to the Phase 4 options.

When complete and ready for planning, display:

```text
Brainstorm complete!

Requirements doc: docs/brainstorms/YYYY-MM-DD-<topic>-requirements.md  # if one was created

Key decisions:
- [Decision 1]
- [Decision 2]

Recommended next step: `ce-plan`
```

If the user pauses with `Resolve Before Planning` still populated, display:

```text
Brainstorm paused.

Requirements doc: docs/brainstorms/YYYY-MM-DD-<topic>-requirements.md  # if one was created

Planning is blocked by:
- [Blocking question 1]
- [Blocking question 2]

Resume with `ce-brainstorm` when ready to resolve these before planning.
```
