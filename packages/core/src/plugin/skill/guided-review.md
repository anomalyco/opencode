<!--
  Built-in skill. Name and description are registered in code at
  packages/core/src/plugin/skill.ts. The body below becomes the skill's
  content.
-->

# Guided Review

Review code changes the way the `/review` command does, but explain the review
for a reader who has never seen this codebase. The user understands code and
works through AI agents, so they have a rough sense of this project but not an
exact mental model of it. A guided review must leave them able to act on every
finding without asking a follow-up question about what it means.

## Non-negotiables

1. **Run the review in a subagent.** Never review inline, not even for a tiny
   diff. Spawn a child agent with the `subagent` tool and relay its review.
2. **Do not block on a model choice.** Start the review with the subagent's
   normal model and leave `model` unset. Only ask which model to use when the
   user asks to choose one.
3. **Assume no knowledge of the codebase.** Explain instead of referencing.
   Every finding names and explains the parts of the system it depends on.

If this environment does not provide the `subagent` tool, use the equivalent
child-agent tool. The requirement is a fresh child context, never an inline
review.

## 1. Determine the target

Use the same rules as `/review`:

| Input | Review | Gather with |
| --- | --- | --- |
| No target | Uncommitted changes | `git diff`, `git diff --cached`, `git status --short` |
| Commit hash | That commit | `git show <hash>` |
| Branch name | Current branch against that branch | `git diff <branch>...HEAD` |
| PR URL or number | That pull request | `gh pr view <ref>`, `gh pr diff <ref>` |

If GitHub CLI is unavailable for a PR, fetch the PR diff from its URL with
webfetch instead. Use judgement for other inputs. If there is nothing to
review, tell the user and stop; do not invent a review.

## 2. Choose the model

Start the review with the subagent's normal model: do not ask, and do not set
`model`, unless the user asks to choose one.

When the user does ask, look up candidates with the `models` tool (filter to
your own provider first), then ask one question:

```text
header: "Review model"
question: "Which model should run the review subagent for <resolved target>?"
options:
  - label: "<current session model> (Recommended)"
    description: "The model this session already uses."
  - label: "<provider/model or provider/model#variant>"
    description: "<why it fits, e.g. strongest reasoning for tricky logic>"
```

Use the exact `provider/model` (or `provider/model#variant`) value the user
picks, and pass it as `model`. Do not guess model IDs. If the user already
named a model, use it as-is.

## 3. Spawn the reviewer subagent

Call the `subagent` tool with:

- `agent: "general"`
- `description: "Guided code review"`
- `model`: leave it unset by default. Pass the model the user picked only when
  they asked to choose one.
- Foreground (do not pass `background`) so the review returns in this turn.
- `prompt`: a self-contained brief. The child starts from a blank slate and
  cannot spawn its own subagents, so it must do its own reading and searching.
  Include the user's request, the resolved target, and this template:

```text
Review code in <absolute path>.

Target: <uncommitted changes | commit <hash> | current branch vs <branch> | PR <ref>>.
Gather the diff with: <exact git or gh commands>.

Read every changed file in full and the code around it (callers, callees,
types) so you understand how the change fits. Check conventions files
(AGENTS.md, CONTRIBUTING.md) before judging style.

The user's request, verbatim: <request>

What to look for, in order:

1. Bugs - logic errors, off-by-one, wrong or missing guards, unreachable
   branches, edge cases (null/empty inputs, error paths, races), security
   (injection, auth bypass, data exposure), error handling that swallows
   failures or throws unexpectedly.
2. Structure - does the change follow existing patterns, reuse existing
   abstractions, avoid excessive nesting?
3. Performance - only flag clearly problematic cases (unbounded O(n^2), N+1
   queries, blocking I/O on hot paths).
4. Behavior changes - surface any behavior change, especially possibly
   unintentional ones.

Only review the changed code, not pre-existing code. Be certain before calling
something a bug; investigate with tools instead of guessing. Do not invent
hypothetical problems; when an edge case matters, give the realistic scenario
where it breaks. Do not be a style zealot; verify a convention violation
before flagging it.

Write for a reader who has never seen this codebase. They know programming and
use AI agents daily, but have no exact mental model of this project. Never
assume knowledge of its architecture, naming, or history. Explain a module,
type, or pattern the first time you mention it. Explain the mechanism behind
each issue, not only the symptom. Use file paths, symbol names, and line
numbers. Matter-of-fact tone, no flattery, do not overstate severity.

Return exactly these sections:

## What this change does
2-5 sentences: the behavior that changes, why it exists when inferable (say so
when you are inferring), and which parts of the system are involved. Define
every project-specific term on first use.

## Where it fits
A short orientation for a newcomer: the files and areas touched, their role in
the project, the flow that runs through them, and the patterns the change
relies on. Orientation only, no findings.

## Findings
Ordered by severity: `blocker`, `high`, `medium`, `low`, `nit`. For each one:

- **Where**: `path/file.ext:LINE`
- **What**: the problem in one or two sentences.
- **Why it matters**: the mechanism and consequence in plain language; add a
  sentence or two of background when the finding depends on a concept.
- **When it bites**: the inputs, environment, or scenario required.
- **Suggested fix**: a concrete direction, not a full patch.

If there are no findings, say so plainly. Never pad the list.

## Verified
What you read and ran, and what you could not verify, including anything you
are unsure about. Never present an uncertain claim as fact.

Do not modify any files.
```

## 4. Relay the review

Present the review to the user nearly verbatim; it was written for them. A
one-line lead-in is fine. Do not rewrite, shorten, reorder, or soften it, and
do not act on findings unless asked. If the child ignored the format or skipped
the plain-language explanation, continue the same child session with the
`subagent` tool via its `sessionID` and ask it to fix the output instead of
starting a new review.

Finish by offering natural next steps: explain any finding in more depth, look
at a specific file, or fix the issues.
