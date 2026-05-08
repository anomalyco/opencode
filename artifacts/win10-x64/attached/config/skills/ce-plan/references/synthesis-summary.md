# Synthesis Summary

**Synthesis ≠ plan doc.** The synthesis is the scope/decisions checkpoint that plan-write (Phase 5.2) consumes as input. The plan itself is written from the confirmed synthesis. The synthesis names the scope or plan-time decisions (what files to touch, which patterns to extend, what's deferred) at decision-level. The plan body expands those decisions into directional sketches (file paths, test scenarios, approach descriptions) per the Planning Rules — but never into exact method signatures, framework syntax, or code spec (Phase 4.3 forbids those in the plan body too). If the synthesis reads like a plan preview, it's misshaped — re-cut to scope/decisions-only.

**Three-bucket structure is a chat-time artifact only.** It does its scope-confirmation job in dialogue with the user, then dissolves when Phase 5.2 writes the plan: Stated content informs Requirements, Inferred content informs Key Technical Decisions / Implementation Units (interactive mode) or `## Assumptions` (non-interactive mode), Out-of-scope content informs Scope Boundaries. The plan has no parallel `## Synthesis` section — only the prose summary embeds, as `## Summary`. See "Doc shape after confirmation" below for the routing.

This content is loaded when a synthesis-summary phase fires in ce-plan. There are two variants — they share structure but differ in timing and content focus:

- **Solo variant** (Phase 0.7): fires after Phase 0.4 bootstrap and Phase 0.6 depth classification, before Phase 1 research begins. Catches scope misinterpretation before sub-agent dispatch is spent. Full breadth — problem frame, intended behavior, success criteria, in/out scope.
- **Brainstorm-sourced variant** (Phase 5.1.5): fires after Phase 1 research, before Phase 5.2 plan-write. Focuses on plan-time decisions (which files/modules to touch, which patterns extended vs. introduced new, test scope, refactor scope). Brainstorm-validated WHAT is assumed and not re-stated.

Both variants share the three-bucket structure, open prose feedback, soft-cut behavior, and the doc-shape routing. In non-interactive (headless) mode, both compose the synthesis but skip the user confirmation step — Inferred bets route to a `## Assumptions` section in the plan rather than to Key Technical Decisions. See "Headless mode (shared)" below for the full routing.

---

## Three-bucket structure (shared)

Every synthesis is structured in three labeled buckets. Items may appear in two buckets when meaningfully both — flag the inclusion-then-exclusion as Inferred so the reader sees the agent's reasoning.

- **Stated** — what the user said directly (in the original prompt, prior conversation, dialogue answers, or the upstream brainstorm doc when present). Items here have explicit user-language anchors.
- **Inferred** — what the agent assumed to fill gaps. Scope boundaries the user never explicitly named, success criteria extrapolated from intent, technical assumptions made because the brief interview didn't probe them. The "Inferred" list is the most actionable bucket — items here are the agent's bets that the user can correct.
- **Out of scope** — deliberately excluded items. Adjacent work the agent considered but decided not to include, refactors, nice-to-haves, future-work items.

---

## Synthesis structural discipline (shared)

Both variants share these structural rules. They address failure modes where the synthesis becomes a Phase 5.2 (plan-write) preview instead of a scope checkpoint.

**Prose lives inside the synthesis section**, immediately after the lead-in line and before the Stated bucket — not as a separate prose block above the synthesis. Putting extensive prose ABOVE the synthesis (an approach pitch, files-touched bullets, rationale block) inverts the structure: the synthesis becomes a footnote to the proposal instead of the proposal being a 1-3 line gloss on the synthesis.

**Anti-pattern: synthesis as plan-pitch.** Plan-body content — file paths, code shapes, sentinel strings, exact error messages, "Recommendation" / "Behavior when X" / "Why this shape" rationale — does not belong in the synthesis regardless of where it appears: not in a block above the buckets, not inside the prose summary, and not nested in an Inferred bullet's commentary or sub-bullets. The position rule and the content rule are independent: a structurally-legal placement (inside a bucket bullet) does not legitimize plan-body content. If you find yourself writing it anywhere, stop. That content is Phase 5.2 (plan-write) territory — it belongs in the plan body the next phase will write, not in the synthesis presentation. The synthesis is a scope/decisions checkpoint: three buckets plus a 1-3 line gloss. Implementation detail leaking into the synthesis (anywhere) is a sign Phases 1-4 (research and structuring) and Phase 5.2 (plan-write) have collapsed into the synthesis-confirmation step.

**A revision is not a confirmation.** After any user revision (even a trivially-understood swap), integrate the change, re-present the revised synthesis with the change reflected, and wait for explicit confirmation before writing the plan. The loop is:

1. Present synthesis → user responds
2. User confirms → write the plan
3. User revises → integrate, re-present revised synthesis, return to step 1

Plan-write (Phase 5.2) fires only on explicit confirm or after the soft-cut blocking question's "proceed" option. Never write immediately after a revision, even when the revision is small enough that the agent feels it understood — the confirmation step is what makes the synthesis **confirmed** rather than "agent's last proposal."

---

## Granularity: name the decision; don't expand it (shared)

Each Inferred bullet should be affirmable or rejectable by the user **without reading code**. Name the decision at the granularity that lets the user say "yes" or "I want X instead." Anything more specific is plan-body content — Phase 5.2's job, not synthesis's.

**Allowed** (when these ARE the decisions being made):
- File / module names — "skip filter in the matcher" when "where to put it" is the choice
- Pattern names — "extends the existing event-skip pattern" when "extend vs. introduce" is the choice
- Column / table names — "user-TZ" or "destination-calendar TZ" when "which source" is the choice
- Approach posture — "DB-side query with Google-side fallback" when "which strategy" is the choice

**Not allowed** (always plan-body, regardless of variant):
- Line numbers (`route.ts:249-255`)
- Exact method signatures, call graphs, or implementation flow ("at the top, before include/exclude evaluation, returning ...")
- Exact JSON / response shapes (`{pause, cleanup: {eventsDeleted, eventsFailed, errors}}`)
- HTTP status codes (`409`, `404`, `403`)
- Exact event / activity-log / type names (`userPauseSet/userPauseEdited/...`)
- Exact wording of error messages or UI labels
- SQL syntax or query bodies

The line is drawn slightly differently per variant. **Solo (Phase 0.7)** stays at the higher level — brainstorm's WHAT hasn't been validated yet, so file/module names are usually too specific; talk in terms of "the rule entity," not "syncRules table." **Brainstorm-sourced (Phase 5.1.5)** allows the file / module / pattern / column level when those ARE plan-time decisions, but not implementation flow specifics.

### Bad-vs-good examples

| Plan-body in synthesis (wrong) | Decision-level (right) |
|---|---|
| Timezone source: `users.timezone` (IANA), fallback to destination calendar TZ if null. Research found `useTimezoneSync` and `ProtectionStatsCalculator` establish the pattern. | Timezone source: user-TZ (reverses brainstorm's tentative lean — research found established infra and pattern precedent) |
| Skip filter goes in `RuleMatcher.eventMatchesRule` at the top, before include/exclude evaluation, using the existing `filteredReason` mechanism. | Skip filter extends the existing event-skip pattern in the matcher (vs. introducing a new mechanism) |
| Reactivation guard: explicit safety in `[ruleId]/route.ts` PATCH — when `isActive: false → true`, the existing handler clears `status/pausedAt/pausedReason`. | Reactivation guard: pause window state preserved through the isActive toggle's existing system-pause-clearing path |
| Partial cleanup failure response: `{pause, cleanup: {eventsDeleted, eventsFailed, errors}}`; pause window persists regardless of cleanup outcome. | Partial cleanup failure: pause window persists; partial-failure response mirrors the existing rule-edit precedent |

The test: a scanner reading an Inferred bullet should affirm or reject it without needing to read code. If they would have to look up a column name, method name, or call graph to evaluate the bullet, the granularity is wrong — that's plan-body content.

---

## Solo variant (Phase 0.7)

Fires only when:
- Phase 0.2 found no upstream brainstorm doc
- AND Phase 0.4 stayed in ce-plan (did not route to ce-debug, ce-work, or universal-planning)
- AND Phase 0.5 cleared (no unresolved blockers)
- AND not on Phase 0.1 fast paths (resume normal, deepen-intent)

Each guard is an explicit conditional in SKILL.md, not implicit. R2 solo does NOT fire on resume/deepen, route-out, or brainstorm-sourced paths.

**Content focus**: full-breadth synthesis. Phase 0.4 bootstrap is brief by design ("ask one or two clarifying questions"), so the agent has made substantial inferences before Phase 0.7 fires. The "Inferred" list is especially load-bearing here — surface the agent's bets explicitly.

**Counter-warning for rich-context invocations.** When the inference source is *not* just Phase 0.4 bootstrap — e.g., a prior in-conversation validation agent, completed sibling work units earlier in the same session, or a planning artifact already in the conversation — "surface bets explicitly" pulls toward dumping that material verbatim. The granularity rules tighten in this case, not loosen: the agent has more material to compress, not more material to expose. A bet that's already been validated upstream is **Stated**, not Inferred; a bet whose specifics belong in plan-body is named at decision-level here regardless of how much detail upstream context provided. If recent turns produced detailed code, file paths, or research artifacts, expect the synthesis draft to over-share and compress proactively before presenting.

**Why pre-research, not pre-write**: research effort would be wasted if scope is wrong. Catching scope errors before sub-agent dispatch (Phase 1.1's repo-research-analyst, learnings-researcher, etc.) saves token and time cost.

### Prompt template (solo)

**Prose summary discipline (required for all tiers):** start with a 1-3 line summary in plain prose describing **what scope the plan will target**. Forward-looking (what *will* be planned), not retrospective (what's been discussed in Phase 0.4 bootstrap). The prose's job is to help the user pattern-match against intent before reading bullets — solo invocation has minimal pre-write dialogue, so the prose is especially load-bearing here. Even Lightweight benefits from a gestalt; the only legitimate skip is the truly-trivial case (e.g., the prompt was itself a complete scope statement and the synthesis is one or two Stated bullets that just echo it).

**Anti-fluff guidance:** lead with the actual thing being planned in plain words. No qualifiers ("comprehensive," "thoughtful," "substantive"). No re-stating the user's prompt. If you can't say what the scope is in 1-3 lines without filler, the synthesis isn't ready yet.

```
Based on your request and our brief Phase 0.4 bootstrap, here's the scope I'm proposing to plan against:

[1-3 line prose summary — what scope the plan will target, in plain language. Required for all tiers; skip only for truly-trivial cases where the synthesis is ≤ 2 bullets that echo the prompt.]

**Stated** (from your input and our dialogue):
- [item]

**Inferred** (gaps I filled with assumptions — Phase 0.4 is brief by design, so this list is load-bearing; flag anything I got wrong):
- [problem frame inference]
- [success criteria inference]
- [scope boundary inference]
- [technical approach assumption]

**Out of scope** (deliberately excluded):
- [adjacent work]
- [refactor]
- [nice-to-have]

Does this match your intent? Tell me what to add, remove, redirect, or that I got wrong — or just confirm to proceed. (You can also redirect to /ce-brainstorm if this is bigger than you initially thought — I'll stop here and load it for you.)
```

Use prose for the user response (no `AskUserQuestion` menu). Justification is Interaction Rule 5(a) in SKILL.md.

---

## Brainstorm-sourced variant (Phase 5.1.5)

Fires only when:
- Phase 0.2 found upstream brainstorm doc (brainstorm-sourced invocation)
- AND not on Phase 0.1 fast paths

**Content focus**: plan-time decisions only. The brainstorm + R1 synthesis already validated WHAT to build; this synthesis surfaces HOW the plan will execute that work — decisions the brainstorm did not make.

Items to surface:
- **Files/modules to touch (and not touch)** — what the implementation reaches into
- **Patterns extended vs. introduced new** — architectural decisions the agent made within confirmed scope (R2's content focus, not bias toward either direction)
- **Test scope** — which existing-but-untested code is in/out of test scope for this work
- **Refactor scope** — adjacent cleanup, if any, going to deferred items vs. active diff
- **Cross-cutting impact** — auth, migrations, shared types when they're touched

**Reads from doc body, not a synthesis section**: brainstorm docs do not have a `## Synthesis` section (the synthesis is a chat-time artifact in ce-brainstorm; only the prose summary embeds, as `## Summary`). Phase 5.1.5 derives plan-time decisions from the brainstorm doc's body sections — Summary, Problem Frame, Requirements, Key Decisions, Scope Boundaries — plus Phase 1 research. Older brainstorms that may have a legacy `## Synthesis` section work fine; that content is treated as supplementary, not authoritative, with the body sections taking precedence.

**Why pre-write, not pre-research**: brainstorm doc + R1 synthesis already validated WHAT, so research is well-targeted. Plan-time decisions emerge during research and structuring (Phases 1-4), so pre-write catches them at the latest cheap moment — before Phase 5.2 commits the plan to disk.

### Prompt template (brainstorm-sourced)

**Prose summary discipline (required for all tiers):** start with a 1-3 line summary in plain prose describing **how the implementation approaches the work** at a high level — files/modules touched, patterns extended vs. introduced, scope boundaries the plan honors. Forward-looking (what *will* be in the plan), not retrospective. Brainstorm-validated WHAT is assumed; the prose summarizes HOW. Even Lightweight benefits from a gestalt; the only legitimate skip is the truly-trivial case (e.g., a one-line refactor where the synthesis is one or two Stated bullets that just echo the prompt).

**Anti-fluff guidance:** lead with the actual implementation shape in plain words. No qualifiers, no re-stating the brainstorm's WHAT. If the prose just restates the brainstorm's Problem Frame, rewrite it to focus on plan-time decisions.

```
Based on the upstream brainstorm and Phase 1 research, here's the implementation scope I'm proposing for the plan:

[1-3 line prose summary — how the implementation approaches the work (files/modules, patterns, scope honored), in plain language. Brainstorm-validated WHAT is assumed; this summarizes HOW. Required for all tiers; skip only for truly-trivial cases where the synthesis is ≤ 2 bullets that echo the prompt.]

**Stated** (from brainstorm + research findings):
- [files/modules implicitly named in brainstorm or surfaced by repo-research]
- [patterns identified for extension or reuse]

**Inferred** (plan-time decisions filling gaps the brainstorm didn't resolve):
- [pattern extension vs. new abstraction choice]
- [test scope additions]
- [cross-cutting impact assessment]

**Out of scope** (deliberately excluded):
- [tangential refactors going to Deferred to Follow-Up Work]
- [adjacent untested code intentionally excluded from test scope]

Does this match your intent for HOW to implement? Tell me what to add, remove, or redirect — or just confirm to proceed.
```

Use prose for the user response. Justification is Interaction Rule 5(a).

---

## Soft-cut on circularity (shared)

Track which Stated/Inferred/Out items the user touched per round. The soft-cut blocking question fires **only when the same item is revised twice** (or a third-round revision targets an item already revised in round two). New-item revisions across rounds proceed without limit.

When the soft-cut fires, use the platform's blocking question tool with two options:

- `Proceed with the current revised synthesis`
- `Stop and redirect — discuss further before [research / plan-write]`

Fall back to numbered list in chat only when no blocking tool exists or the call errors. Never silently skip.

---

## Headless mode (shared)

When the skill is invoked from an automated workflow such as LFG or any `disable-model-invocation` context, the skill runs in non-interactive mode (no synchronous user). The artifact is read by downstream skills (ce-doc-review, ce-work) and human reviewers (PR review).

**Per-variant behavior** (the timing matters for which phases follow):

- **Solo variant (Phase 0.7)**: Phase 0.7 fires *before* research. In non-interactive mode, compose the synthesis but skip the user confirmation step. Continue to Phase 1 research as normal. Inferred content is held until plan-write (Phase 5.2), where it routes to `## Assumptions`.
- **Brainstorm-sourced variant (Phase 5.1.5)**: Phase 5.1.5 fires *after* research, before plan-write. Compose the synthesis but skip the user confirmation step. Proceed to Phase 5.2 plan-write. Inferred content routes to `## Assumptions`.

**Shared behavior across both variants:**

- **No user prompt; no blocking question.** Skip the confirmation step.
- **Route content with mode-aware shape:**
  - **Stated** content → Requirements (user-stated constraints, traced to origin's R-IDs when present)
  - **Out-of-scope** content → Scope Boundaries
  - **Inferred** content → `## Assumptions` section in the plan — explicitly labeled as un-validated agent bets. Do NOT route Inferred items into Key Technical Decisions or Implementation Units; that would make un-validated bets indistinguishable from user-confirmed decisions.

The `## Assumptions` section appears in non-interactive plans only. Interactive plans don't need it (Inferred bets get user-corrected in chat and become Key Technical Decisions or are revised away).

This restores the audit visibility the original design intended (un-validated bets must not propagate as authoritative content), but surfaces them under their own label rather than hiding them. Downstream review (ce-doc-review, ce-work, human PR review) can scrutinize Assumptions specifically.

---

## Self-redirect (shared)

If the user response indicates they're in the wrong skill or want a different workflow:

- **Solo variant**: common redirects include "this is bigger than I thought — let me brainstorm first" (suggest `/ce-brainstorm`), "this is just a fix, no plan needed" (suggest `/ce-work`), or "I need to investigate first" (suggest `/ce-debug`).
- **Brainstorm-sourced variant**: less common, but possible — "actually this scope is wrong, take it back to brainstorm" (suggest `/ce-brainstorm` to revise the upstream doc).

In either case: stop ce-plan, suggest the alternative skill, offer to load it in-session. Don't push back or argue — the user's redirect signal is the deliberate choice.

---

## Doc shape after confirmation

After user confirmation (or after the soft-cut decision proceeds), Phase 5.2 writes the plan doc. The three-bucket structure does NOT carry into the plan as a `## Synthesis` section. Only the prose summary embeds, replacing the existing `## Overview` slot in the plan template (renamed to `## Summary` for terminology consistency). Bucket content dissolves into the plan's body sections:

| Chat-time element | Where it goes in the plan |
|---|---|
| Prose summary | `## Summary` (1-3 lines, forward-looking) — solo variant: scope being targeted; brainstorm-sourced: implementation approach |
| Stated bullets | `## Requirements` (R-IDs) and where relevant `## Problem Frame` for narrative context |
| Inferred bullets | `## Key Technical Decisions` (with rationale) and Implementation Units when the bet drives a structural choice. In non-interactive mode, route to `## Assumptions` instead — see Headless mode below. |
| Out-of-scope bullets | `## Scope Boundaries` — including the `### Deferred to Follow-Up Work` subsection when relevant |

No italic capture-context note (e.g., "Captured at Phase 0.7..."). It would leak engineering process into an artifact whose readers do not need that signal.

The plan's `## Summary` and `## Problem Frame` must serve distinct purposes: Summary answers "what is this plan proposing?" (forward-looking, 1-3 lines); Problem Frame answers "why does this proposal exist?" (backward-looking, paragraphs). Don't restate the proposal in Problem Frame; don't pad Summary with situational context.

---

## What does NOT belong in the synthesis

- Implementation code (no imports, exact method signatures, framework-specific syntax, JSON shapes, exact error message wording)
- Re-statement of the entire brainstorm doc — the synthesis is plan-perspective, not a copy
- Defensive what-ifs and hedges — if a concern is real, state it as Inferred or Out; if speculation, drop it
- Open questions surfaced outside the three buckets — by synthesis time, every scope-shaping question must be in **Stated** (asked and answered earlier), **Inferred** (agent's bet for correction), or **Out** (deliberately excluded). There is no fourth status. If a question genuinely cannot be defaulted, pause synthesis and resolve it before presenting — pick the question shape that matches: a blocking multiple-choice tool when options are bounded and meaningfully distinct, prose when option sets would bias the answer per Interaction Rule 5(a). Integrate the answer, then present synthesis. Never present synthesis with adjacent floating questions — that gives the user no clear resolution path
