---
name: ce-debug
description: 'Systematically find root causes and fix bugs. Use when debugging errors, investigating test failures, reproducing bugs from issue trackers (GitHub, Linear, Jira), or when stuck on a problem after failed fix attempts. Also use when the user says ''debug this'', ''why is this failing'', ''fix this bug'', ''trace this error'', or pastes stack traces, error messages, or issue references.'
argument-hint: "[issue reference, error message, test path, or description of broken behavior]"
---

# Debug and Fix

Find root causes, then fix them. This skill investigates bugs systematically — tracing the full causal chain before proposing a fix — and optionally implements the fix with test-first discipline.

<bug_description> #$ARGUMENTS </bug_description>

## Core Principles

These principles govern every phase. They are repeated at decision points because they matter most when the pressure to skip them is highest.

1. **Investigate before fixing.** Do not propose a fix until you can explain the full causal chain from trigger to symptom with no gaps. "Somehow X leads to Y" is a gap.
2. **Predictions for uncertain links.** When the causal chain has uncertain or non-obvious links, form a prediction — something in a different code path or scenario that must also be true. If the prediction is wrong but a fix "works," you found a symptom, not the cause. When the chain is obvious (missing import, clear null reference), the chain explanation itself is sufficient.
3. **One change at a time.** Test one hypothesis, change one thing. If you're changing multiple things to "see if it helps," stop — that is shotgun debugging.
4. **When stuck, diagnose why — don't just try harder.**

## Execution Flow

| Phase | Name | Purpose |
|-------|------|---------|
| 0 | Triage | Parse input, fetch issue if referenced, proceed to investigation |
| 1 | Investigate | Reproduce the bug, trace the code path |
| 2 | Root Cause | Form hypotheses with predictions for uncertain links, test them, **causal chain gate**, smart escalation |
| 3 | Fix | Only if user chose to fix. Test-first fix with workspace safety checks |
| 4 | Handoff | Structured summary, then prompt the user for the next action |

All phases self-size — a simple bug flows through them in seconds, a complex bug spends more time in each naturally. No complexity classification, no phase skipping.

---

### Phase 0: Triage

Parse the input and reach a clear problem statement.

**If the input references an issue tracker**, fetch it:
- GitHub (`#123`, `org/repo#123`, github.com URL): Parse the issue reference from `<bug_description>` and fetch with `gh issue view <number> --json title,body,comments,labels`. For URLs, pass the URL directly to `gh`.
- Other trackers (Linear URL/ID, Jira URL/key, any tracker URL): Attempt to fetch using available MCP tools or by fetching the URL content. If the fetch fails — auth, missing tool, non-public page — ask the user to paste the relevant issue content. Ensure the fetch includes the full comment thread, not just the opening description.

Read the full conversation — the original description AND every comment, with particular attention to the latest ones. Comments frequently contain updated reproduction steps, narrowed scope, prior failed attempts, additional stack traces, or a pivot to a different suspected root cause; treating the opening post as the whole picture often sends the investigation in the wrong direction. Extract reported symptoms, expected behavior, reproduction steps, and environment details from the combined thread. Then proceed to Phase 1.

**Everything else** (stack traces, test paths, error messages, descriptions of broken behavior): Proceed directly to Phase 1.

**Questions:**
- Do not ask questions by default — investigate first (read code, run tests, trace errors)
- Only ask when a genuine ambiguity blocks investigation and cannot be resolved by reading code or running tests
- When asking, ask one specific question

**Prior-attempt awareness:** If the user indicates prior failed attempts ("I've been trying", "keeps failing", "stuck"), ask what they have already tried before investigating. This avoids repeating failed approaches and is one of the few cases where asking first is the right call.

---

### Phase 1: Investigate

#### 1.1 Reproduce the bug

Confirm the bug exists and understand its behavior. Run the test, trigger the error, follow reported reproduction steps — whatever matches the input.

- **Browser bugs:** Prefer `agent-browser` if installed. Otherwise use whatever works — MCP browser tools, direct URL testing, screenshot capture, etc.
- **Manual setup required:** If reproduction needs specific conditions the agent cannot create alone (data states, user roles, external services, environment config), document the exact setup steps and guide the user through them. Clear step-by-step instructions save significant time even when the process is fully manual.
- **Does not reproduce after 2-3 attempts:** Read `references/investigation-techniques.md` for intermittent-bug techniques.
- **Cannot reproduce at all in this environment:** Document what was tried and what conditions appear to be missing.

#### 1.2 Verify environment sanity

Before deep code tracing, confirm the environment is what you think it is:

- Correct branch checked out; no unintended uncommitted changes
- Dependencies installed and up to date (`bun install`, `npm install`, `bundle install`, etc.) — stale `node_modules`/`vendor` is a frequent false lead
- Expected interpreter or runtime version (check `.tool-versions`, `.nvmrc`, `Gemfile`, etc. against what's actually active)
- Required env vars present and non-empty
- No stale build artifacts (`dist/`, `.next/`, compiled binaries from an earlier branch)
- Dependent local services (database, cache, queue) running at expected versions *when the bug plausibly involves them*

#### 1.3 Trace the code path

Read the relevant source files. Follow the execution path from entry point to where the error manifests. Trace backward through the call chain:

- Start at the error
- Ask "where did this value come from?" and "who called this?"
- Keep going upstream until finding the point where valid state first became invalid
- Do not stop at the first function that looks wrong — the root cause is where bad state originates, not where it is first observed

As you trace:
- Check recent changes in files you are reading: `git log --oneline -10 -- [file]`
- If the bug looks like a regression ("it worked before"), use `git bisect` (see `references/investigation-techniques.md`)
- Check the project's observability tools for additional evidence:
  - Error trackers (Sentry, AppSignal, Datadog, BetterStack, Bugsnag)
  - Application logs
  - Browser console output
  - Database state
- Each project has different systems available; use whatever gives a more complete picture

---

### Phase 2: Root Cause

*Reminder: investigate before fixing. Do not propose a fix until you can explain the full causal chain from trigger to symptom with no gaps.*

Read `references/anti-patterns.md` before forming hypotheses.

**Assumption audit (before hypothesis formation):** List the concrete "this must be true" beliefs your understanding depends on — the framework behaves as expected here, this function returns what its name implies, the config loads before this runs, the caller passes a non-null value, the database is in the state the test implies. For each, mark *verified* (you read the code, checked state, or ran it) or *assumed*. Assumptions are the most common source of stuck debugging. Many "wrong hypotheses" are actually correct hypotheses tested against a wrong assumption.

**Form hypotheses** ranked by likelihood. For each, state:
- What is wrong and where (file:line)
- The causal chain: how the trigger leads to the observed symptom, step by step
- **For uncertain links in the chain**: a prediction — something in a different code path or scenario that must also be true if this link is correct

When the causal chain is obvious and has no uncertain links (missing import, clear type error, explicit null dereference), the chain explanation itself is the gate — no prediction required. Predictions are a tool for testing uncertain links, not a ritual for every hypothesis.

Before forming a new hypothesis, review what has already been ruled out and why.

**Causal chain gate:** Do not proceed to Phase 3 until you can explain the full causal chain — from the original trigger through every step to the observed symptom — with no gaps. The user can explicitly authorize proceeding with the best-available hypothesis if investigation is stuck.

*Reminder: if a prediction was wrong but the fix appears to work, you found a symptom. The real cause is still active.*

#### Present findings

Once the root cause is confirmed, present:
- The root cause (causal chain summary with file:line references)
- The proposed fix and which files would change
- Which tests to add or modify to prevent recurrence (specific test file, test case description, what the assertion should verify)
- Whether existing tests should have caught this and why they did not

Then offer next steps.

Use the platform's blocking question tool (`AskUserQuestion` in Claude Code, `request_user_input` in Codex, `ask_user` in Gemini, `ask_user` in Pi (requires the `pi-ask-user` extension)). In Claude Code, call `ToolSearch` with `select:AskUserQuestion` first if its schema isn't loaded — a pending schema load is not a reason to fall back. Fall back to numbered options in chat only when no blocking tool exists in the harness or the call errors (e.g., Codex edit modes). Never silently skip the question.

Options to offer:

1. **Fix it now** — proceed to Phase 3
2. **Diagnosis only — I'll take it from here** — skip the fix, proceed to Phase 4's summary, and end the skill
3. **Rethink the design** (`/ce-brainstorm`) — only when the root cause reveals a design problem (see below)

Do not assume the user wants action right now. The test recommendations are part of the diagnosis regardless of which path is chosen.

**When to suggest brainstorm:** Only when investigation reveals the bug cannot be properly fixed within the current design — the design itself needs to change. Concrete signals observable during debugging:

- **The root cause is a wrong responsibility or interface**, not wrong logic. The module should not be doing this at all, or the boundary between components is in the wrong place. (Observable: the fix requires moving responsibility between modules, not correcting code within one.)
- **The requirements are wrong or incomplete.** The system behaves as designed, but the design does not match what users actually need. The "bug" is really a product gap. (Observable: the code is doing exactly what it was written to do — the spec is the problem.)
- **Every fix is a workaround.** You can patch the symptom, but cannot articulate a clean fix because the surrounding code was built on an assumption that no longer holds. (Observable: you keep wanting to add special cases or flags rather than a direct correction.)

Do not suggest brainstorm for bugs that are large but have a clear fix — size alone does not make something a design problem.

#### Smart escalation

If 2-3 hypotheses are exhausted without confirmation, diagnose why:

| Pattern | Diagnosis | Next move |
|---------|-----------|-----------|
| Hypotheses point to different subsystems | Architecture/design problem, not a localized bug | Present findings, suggest `/ce-brainstorm` |
| Evidence contradicts itself | Wrong mental model of the code | Step back, re-read the code path without assumptions |
| Works locally, fails in CI/prod | Environment problem | Focus on env differences, config, dependencies, timing |
| Fix works but prediction was wrong | Symptom fix, not root cause | The real cause is still active — keep investigating |

**Parallel investigation option:** When hypotheses are evidence-bottlenecked across clearly independent subsystems, dispatch read-only sub-agents in parallel, each with an explicit hypothesis and structured evidence-return format. No code edits by sub-agents, and skip this when hypotheses depend on each other's outcomes. If the platform does not support parallel sub-agent dispatch, run the same hypothesis probes sequentially in ranked-likelihood order instead — the parallelism is a latency optimization, not a correctness requirement.

Present the diagnosis to the user before proceeding.

---

### Phase 3: Fix

*Reminder: one change at a time. If you are changing multiple things, stop.*

If the user chose "Diagnosis only" at the end of Phase 2, skip this phase and go straight to Phase 4 for the summary — the skill's job was the diagnosis. If they chose "Rethink the design", control has transferred to `/ce-brainstorm` and this skill ends.

**Workspace and branch check:** Before editing files:

- Check for uncommitted changes (`git status`). If the user has unstaged work in files that need modification, confirm before editing — do not overwrite in-progress changes.
- If the current branch is the default branch, ask whether to create a feature branch first using the platform's blocking question tool (see Phase 2 for the per-platform names). To detect the default branch, compare against `main`, `master`, or the value of `git rev-parse --abbrev-ref origin/HEAD` with its `origin/` prefix stripped (the raw output is `origin/<name>`, so an unstripped comparison will never match the local branch name). Default to creating one; derive a name from the bug and run `git checkout -b <name>`. On any other branch, proceed.

**Test-first:**
1. Write a failing test that captures the bug (or use the existing failing test)
2. Verify it fails for the right reason — the root cause, not unrelated setup
3. Implement the minimal fix — address the root cause and nothing else
4. Verify the test passes
5. Run the broader test suite for regressions

**3 failed fix attempts = smart escalation.** Diagnose using the same table from Phase 2. If fixes keep failing, the root cause identification was likely wrong. Return to Phase 2.

**Conditional defense-in-depth** (trigger: grep for the root-cause pattern found it in 3+ other files, OR the bug would have been catastrophic if it reached production): Read `references/defense-in-depth.md` for the four-layer model (entry validation, invariant check, environment guard, diagnostic breadcrumb) and choose which layers apply. Skip when the root cause is a one-off error with no realistic recurrence path.

**Conditional post-mortem** (trigger: the bug was in production, OR the pattern appears in 3+ locations):
Analyze how this was introduced and what allowed it to survive. Note any systemic gap or repeated pattern found — it informs Phase 4's decision on whether to offer learning capture.

---

### Phase 4: Handoff

**Structured summary** — always write this first:

```
## Debug Summary
**Problem**: [What was broken]
**Root Cause**: [Full causal chain, with file:line references]
**Recommended Tests**: [Tests to add/modify to prevent recurrence, with specific file and assertion guidance]
**Fix**: [What was changed — or "diagnosis only" if Phase 3 was skipped]
**Prevention**: [Test coverage added; defense-in-depth if applicable]
**Confidence**: [High/Medium/Low]
```

**If Phase 3 was skipped** (user chose "Diagnosis only" in Phase 2), stop after the summary — the user already told you they were taking it from here. Do not prompt.

**If Phase 3 ran**, the next move depends on whether the skill created the branch in Phase 3.

#### Skill-owned branch (created in Phase 3): default to commit-and-PR without prompting

1. **Check for contextual overrides first.** Look at the user's original prompt, loaded memories, and the user/repo `AGENTS.md` or `CLAUDE.md` for preferences that conflict with auto commit-and-PR — for example, "always review before pushing", "open PRs as drafts", or "don't open PRs from skills". A signal must be an explicit instruction or a clearly applicable rule, not a vague tonal cue. If any apply, honor them — switch to the pre-existing-branch menu below, or skip the PR step entirely, whichever matches the user's stated preference.
2. **Briefly preview what will happen** — what will be committed, on what branch, and that a PR will be opened — then proceed without waiting for confirmation. The preview exists so the user can interrupt; it is not a blocking question. Format and length are your call; keep it scannable.
3. **Run `/ce-commit-push-pr`.** When the entry came from an issue tracker, include the appropriate auto-close syntax for that tracker in the location it requires — most trackers parse PR descriptions (e.g., `Fixes #N` for GitHub, `Closes ABC-123` for Linear), but some only parse commit messages (e.g., Jira Smart Commits) — so the diagnosis and fix flow back to the issue and it closes on merge. Surface the resulting PR URL.

#### Pre-existing branch (skill did not create it): ask the user

Use the platform's blocking question tool (`AskUserQuestion` in Claude Code, `request_user_input` in Codex, `ask_user` in Gemini, `ask_user` in Pi (requires the `pi-ask-user` extension)). In Claude Code, call `ToolSearch` with `select:AskUserQuestion` first if its schema isn't loaded — a pending schema load is not a reason to fall back. Fall back to numbered options in chat only when no blocking tool exists in the harness or the call errors. Never end the phase without collecting a response.

Options:

1. **Commit and open a PR (`/ce-commit-push-pr`)** — default for most cases
2. **Commit the fix (`/ce-commit`)** — local commit only
3. **Stop here** — user takes it from there

#### After a PR is open (either path): consider offering learning capture

Most bugs are localized mechanical fixes (typo, missed null check, missing import) where the only "lesson" is the bug itself. Compounding those clutters `docs/solutions/` without adding value. Decide which path applies:

- **Skip silently** when the fix is mechanical and there's no generalizable insight. Default to this when in doubt.
- **Offer neutrally** when the lesson can be stated in one sentence — e.g., "X.foo() returns T | undefined when Y, not just T", or "the diagnostic path was non-obvious and worth recording." If you cannot articulate the lesson, skip rather than offer.
- **Lean into the offer** when the pattern appears in 3+ locations OR the root cause reveals a wrong assumption about a shared dependency, framework, or convention that other code is likely to repeat.

When offering, use the blocking question tool described above. If the user accepts, run `/ce-compound`, then commit the resulting learning doc to the same branch and push so the open PR picks up the new commit.
