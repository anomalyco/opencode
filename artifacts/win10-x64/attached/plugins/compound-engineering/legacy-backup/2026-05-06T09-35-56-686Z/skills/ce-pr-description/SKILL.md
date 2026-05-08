---
name: ce-pr-description
description: "Write or regenerate a value-first pull-request description (title + body) for the current branch's commits or for a specified PR. Use when the user says 'write a PR description', 'refresh the PR description', 'regenerate the PR body', 'rewrite this PR', 'freshen the PR', 'update the PR description', 'draft a PR body for this diff', 'describe this PR properly', 'generate the PR title', or pastes a GitHub PR URL / #NN / number. Also used internally by git-commit-push-pr (single-PR flow) and ce-pr-stack (per-layer stack descriptions) so all callers share one writing voice. Input is a natural-language prompt. A PR reference (a full GitHub PR URL, `pr:561`, `#561`, or a bare number alone) picks a specific PR; anything else is treated as optional steering for the default 'describe my current branch' mode. Returns structured {title, body_file} (body written to an OS temp file) for the caller to apply via gh pr edit or gh pr create — this skill never edits the PR itself and never prompts for confirmation."
argument-hint: "[PR ref e.g. pr:561 | #561 | URL] [free-text steering]"
---

# CE PR Description

Generate a conventional-commit-style title and a value-first body describing a pull request's work. Returns structured `{title, body_file}` for the caller to apply — this skill never invokes `gh pr edit` or `gh pr create`, and never prompts for interactive confirmation.

Why a separate skill: several callers need the same writing logic without the single-PR interactive scaffolding that lives in `git-commit-push-pr`. `ce-pr-stack`'s splitting workflow runs this once per layer as a batch; `git-commit-push-pr` runs it inside its full-flow and refresh-mode paths. Extracting keeps one source of truth for the writing principles.

**Naming rationale:** `ce-pr-description`, not `git-pr-description`. Stacking and PR creation are GitHub features; the "PR" in the name refers to the GitHub artifact. Using the `ce-` prefix matches the future convention for plugin skills; sibling `git-*` skills will rename to `ce-*` later, and this skill starts there directly.

---

## Inputs

Input is a free-form prompt. Parse it into two parts:

- **A PR reference, if present.** Any of these patterns counts: a full GitHub PR URL (`https://github.com/owner/repo/pull/NN`), `pr:<number>` or `pr:<URL>`, a bare hashmark form (`#NN`), or the argument being just a number (`561`). Extract the PR reference and treat the rest of the argument as steering text.
- **Everything else is steering text** (a "focus" hint like "emphasize the benchmarks" or "do a good job with the perf story"). It may be combined with a PR reference or stand alone.

No specific grammar is required — read the argument as natural language and identify whichever PR reference is present. If no PR reference is present, default to describing the current branch.

### Mode selection

| What the caller passes | Mode |
|---|---|
| No PR reference (empty argument or steering text only) | **Current-branch mode** — describe the commits on HEAD vs the repo's default base |
| A PR reference (URL, `pr:`, `#NN`, or bare number) | **PR mode** — describe the specified PR |

Steering text is always optional. If present, incorporate it alongside the diff-derived narrative; do not let it override the value-first principles or fabricate content unsupported by the diff.

**Optional `base:<ref>` override (current-branch mode only).** When a caller already knows the intended base branch (e.g., `git-commit-push-pr` has detected `origin/develop` or `origin/release/2026-04` as the target), it can pass `base:<ref>` to pin the base explicitly. The ref must resolve locally. This overrides auto-detection for current-branch mode; PR mode ignores it (PRs already define their own base via `baseRefName`). Most invocations don't need this — auto-detection (existing PR's `baseRefName` → `origin/HEAD`) covers the common case.

**Examples**:

- `ce-pr-description` → current-branch, no focus, auto-detect base
- `ce-pr-description emphasize the benchmarks` → current-branch, focus = "emphasize the benchmarks"
- `ce-pr-description base:origin/develop` → current-branch, base pinned to `origin/develop`
- `ce-pr-description base:origin/develop emphasize perf` → same + focus
- `ce-pr-description pr:561` → PR #561, no focus
- `ce-pr-description #561 do a good job with the perf story` → PR #561, focus = "do a good job with the perf story"
- `ce-pr-description https://github.com/foo/bar/pull/561 emphasize safety` → PR #561 in foo/bar, focus = "emphasize safety"

## Output

Return a structured result with two fields:

- **`title`** -- conventional-commit format: `type: description` or `type(scope): description`. Under 72 characters. Choose `type` based on intent (feat/fix/refactor/docs/chore/perf/test), not file type. Pick the narrowest useful `scope` (skill or agent name, CLI area, or shared label); omit when no single label adds clarity.
- **`body_file`** -- absolute path to an OS temp file (created via `mktemp`) containing the body markdown that follows the writing principles below. Do not emit the body inline in the return.

The caller decides whether to apply via `gh pr edit`, `gh pr create`, or discard, reading the body from `body_file` (e.g., `--body "$(cat "$BODY_FILE")"`). This skill does NOT call those commands itself. No cleanup is required — `mktemp` files live in OS temp storage, which the OS reaps on its own schedule.

---

## What this skill does not do

- No interactive confirmation prompts. If the diff is ambiguous about something important (e.g., the focus hint conflicts with the actual changes), surface the ambiguity in the returned output or raise it to the caller — do not prompt the user directly.
- No branch checkout. Current-branch mode describes the HEAD in the user's current checkout; PR mode describes the specified PR. Neither mode checks out a different branch.
- No compare-and-confirm narrative ("here's what changed since the last version"). The description describes the end state; the caller owns any compare-and-confirm framing.
- No auto-apply via `gh pr edit` or `gh pr create`. Return the output and stop.

Interactive scaffolding (confirmation prompts, compare-and-confirm, apply step) is the caller's responsibility.

---

## Step 1: Resolve the diff and commit list

Parse the input (see Inputs above) and branch on which mode it selects.

### Current-branch mode (default when no PR reference was given)

Determine the base against which to compare, in this priority order:

1. **Caller-supplied `base:<ref>`** — if present, use it verbatim. The caller is asserting the correct base. The ref must resolve locally.
2. **Existing PR's `baseRefName`** — if the current branch already has an open PR on this repo, use that PR's base. Handles feature branches targeting non-default bases (e.g., `develop`) when the PR is already open.
3. **Repo default (`origin/HEAD`)** — fall back for branches with no PR yet and no caller-supplied base.

```bash
# Detect current branch (fail if detached HEAD)
CURRENT_BRANCH=$(git branch --show-current)
if [ -z "$CURRENT_BRANCH" ]; then
  echo "Detached HEAD — current-branch mode requires a branch. Pass a PR reference instead."
  exit 1
fi

# Priority: caller-supplied base: > existing PR's baseRefName > origin/HEAD
if [ -n "$CALLER_BASE" ]; then
  BASE_REF="$CALLER_BASE"
else
  EXISTING_PR_BASE=$(gh pr view --json baseRefName --jq '.baseRefName' 2>/dev/null)
  if [ -n "$EXISTING_PR_BASE" ]; then
    BASE_REF="origin/$EXISTING_PR_BASE"
  else
    BASE_REF=$(git rev-parse --abbrev-ref origin/HEAD 2>/dev/null)
    BASE_REF="${BASE_REF:-origin/main}"
  fi
fi
```

If `$BASE_REF` does not resolve locally (`git rev-parse --verify "$BASE_REF"` fails), the caller (or the user) needs to fetch it first. Exit gracefully with `"Base ref $BASE_REF does not resolve locally. Fetch it before invoking the skill."` — do not attempt recovery.

Gather merge base, commit list, and full diff:

```bash
MERGE_BASE=$(git merge-base "$BASE_REF" HEAD) && echo "MERGE_BASE=$MERGE_BASE" && echo '=== COMMITS ===' && git log --oneline $MERGE_BASE..HEAD && echo '=== DIFF ===' && git diff $MERGE_BASE...HEAD
```

If the commit list is empty, report `"No commits between $BASE_REF and HEAD"` and exit gracefully — there is nothing to describe.

If an existing PR was found in step 1, also capture its body for evidence preservation in Step 3.

### PR mode (when the input contained a PR reference)

Normalize the reference into a form `gh pr view` accepts: a bare number (`561`), a full URL (`https://github.com/owner/repo/pull/561`), or the number extracted from `pr:561` or `#561`. `gh pr view`'s positional argument accepts bare numbers, URLs, and branch names — not `owner/repo#NN` shorthand. For a cross-repo number reference without a URL, the caller would use `-R owner/repo`; this skill accepts a full URL as the simplest cross-repo path, and that's what most callers use.

```bash
gh pr view <pr-ref> --json number,state,title,body,baseRefName,baseRefOid,headRefName,headRefOid,headRepository,headRepositoryOwner,isCrossRepository,commits,url
```

Key JSON fields: `headRefOid` (PR head SHA — prefer over indexing into `commits`), `baseRefOid` (base-branch SHA), `headRepository` + `headRepositoryOwner` (PR source repo), `isCrossRepository`. There is no `baseRepository` field — the base repo is the one queried by `gh pr view` itself.

If the returned `state` is not `OPEN`, report `"PR <number> is <state> (not open); cannot regenerate description"` and exit gracefully without output. Callers expecting `{title, body_file}` must handle this empty case.

**Determine whether the PR lives in the current working directory's repo** by parsing the URL's `<owner>/<repo>` path segments and comparing against `git remote get-url origin` (strip `.git` suffix; handle both `git@github.com:owner/repo` and `https://github.com/owner/repo` forms). If the URL repo matches `origin`'s repo, route to the local-git path (Case A). Otherwise route to the API-only path (Case B). Bare numbers and `#NN` forms implicitly target the current repo → Case A.

**Case A → Case B fallback:** Even when the URL repo matches `origin`, the local clone may not be usable for this PR's refs — shallow clone, detached state missing the base branch, offline, auth issues, GHES quirks. If Case A's fetch or `git merge-base` fails, fall back to Case B rather than failing the skill. Note the fallback in the caller-facing output.

**Case A — PR is in the current repo:**

Read the PR head SHA directly from `headRefOid` in the JSON response above. Fetch the base ref and the head SHA in one call (the fetch is idempotent when refs are already local):

```bash
PR_HEAD_SHA=<headRefOid from JSON>
git fetch --no-tags origin <baseRefName> $PR_HEAD_SHA
```

Using the explicit `$PR_HEAD_SHA` in downstream commands avoids `FETCH_HEAD`'s multi-ref ordering problem (`git rev-parse FETCH_HEAD` returns only the first fetched ref's SHA, which silently breaks a multi-ref fetch).

```bash
MERGE_BASE=$(git merge-base origin/<baseRefName> $PR_HEAD_SHA) && echo "MERGE_BASE=$MERGE_BASE" && echo '=== COMMITS ===' && git log --oneline $MERGE_BASE..$PR_HEAD_SHA && echo '=== DIFF ===' && git diff $MERGE_BASE...$PR_HEAD_SHA
```

If the explicit-SHA fetch is rejected (rare on GitHub, possible on some GHES configurations that disallow fetching non-tip SHAs), fall back to fetching `refs/pull/<number>/head` and reading the PR head SHA from `.git/FETCH_HEAD` by pull-ref pattern:

```bash
git fetch --no-tags origin "refs/pull/<number>/head"
PR_HEAD_SHA=$(awk '/refs\/pull\/[0-9]+\/head/ {print $1; exit}' "$(git rev-parse --git-dir)/FETCH_HEAD")
```

**Case B — PR is in a different repo:**

Skip local git entirely. Read the diff and commit list from the API:

```bash
gh pr diff <pr-ref>
gh pr view <pr-ref> --json commits --jq '.commits[] | [.oid[0:7], .messageHeadline] | @tsv'
```

Same classification/framing/writing pipeline. Note in the caller-facing output that the API fallback was used.

Also capture the existing PR body for evidence preservation in Step 3 (both cases).

---

## Step 2: Classify commits before writing

Scan the commit list and classify each commit:

- **Feature commits** -- implement the PR's purpose (new functionality, intentional refactors, design changes). These drive the description.
- **Fix-up commits** -- iteration work (code review fixes, lint fixes, test fixes, rebase resolutions, style cleanups). Invisible to the reader.

When sizing the description, mentally subtract fix-up commits: a branch with 12 commits but 9 fix-ups is a 3-commit PR.

---

## Step 3: Decide on evidence

Decide whether evidence capture is possible from the full branch diff.

**Evidence is possible** when the diff changes observable behavior demonstrable from the workspace: UI, CLI output, API behavior with runnable code, generated artifacts, or workflow output.

**Evidence is not possible** for:
- Docs-only, markdown-only, changelog-only, release metadata, CI/config-only, test-only, or pure internal refactors
- Behavior requiring unavailable credentials, paid/cloud services, bot tokens, deploy-only infrastructure, or hardware not provided

**This skill does NOT prompt the user** to capture evidence. The decision logic is:

1. **PR mode invocation** (any form: bare number, `#NN`, `pr:<N>`, or a full URL — anything that resolves to an existing PR whose body we fetched) **and the existing body contains a `## Demo` or `## Screenshots` section with image embeds:** preserve it verbatim unless the steering text asks to refresh or remove it. Include the preserved block in the returned body. This applies regardless of which input shape the caller used; what matters is that a PR exists and its body was read.
2. **Current-branch mode or PR mode without an evidence block:** omit the evidence section entirely. If the caller wants to capture evidence, the caller is responsible for invoking `ce-demo-reel` separately and splicing the result in, or for asking this skill to regenerate with updated steering text after capture.

Do not label test output as "Demo" or "Screenshots". Place any preserved evidence block before the Compound Engineering badge.

---

## Step 4: Frame the narrative before sizing

Articulate the PR's narrative frame:

1. **Before**: What was broken, limited, or impossible? (One sentence.)
2. **After**: What's now possible or improved? (One sentence.)
3. **Scope rationale** (only if 2+ separable-looking concerns): Why do these ship together? (One sentence.)

This frame becomes the opening. For small+simple PRs, the "after" sentence alone may be the entire description.

---

## Step 5: Size the change

Assess size (files, diff volume) and complexity (design decisions, trade-offs, cross-cutting concerns) to select description depth:

| Change profile | Description approach |
|---|---|
| Small + simple (typo, config, dep bump) | 1-2 sentences, no headers. Under ~300 characters. |
| Small + non-trivial (bugfix, behavioral change) | Short narrative, ~3-5 sentences. No headers unless two distinct concerns. |
| Medium feature or refactor | Narrative frame (before/after/scope), then what changed and why. Call out design decisions. |
| Large or architecturally significant | Full narrative: problem context, approach (and why), key decisions, migration/rollback if relevant. |
| Performance improvement | Include before/after measurements if available. Markdown table works well. |

When in doubt, shorter is better. Match description weight to change weight.

---

## Step 6: Apply writing principles

### Writing voice

If the repo has documented style preferences in context, follow those. Otherwise:

- Active voice. No em dashes or `--` substitutes; use periods, commas, colons, or parentheses.
- Vary sentence length. Never three similar-length sentences in a row.
- Do not make a claim and immediately explain it. Trust the reader.
- Plain English. Technical jargon fine; business jargon never.
- No filler: "it's worth noting", "importantly", "essentially", "in order to", "leverage", "utilize."
- Digits for numbers ("3 files"), not words ("three files").

### Writing principles

- **Lead with value**: Open with what's now possible or fixed, not what was moved around. The subtler failure is leading with the mechanism ("Replace the hardcoded capture block with a tiered skill") instead of the outcome ("Evidence capture now works for CLI tools and libraries, not just web apps").
- **No orphaned opening paragraphs**: If the description uses `##` headings anywhere, the opening must also be under a heading (e.g., `## Summary`). For short descriptions with no sections, a bare paragraph is fine.
- **Describe the net result, not the journey**: The description covers the end state, not how you got there. No iteration history, debugging steps, intermediate failures, or bugs found and fixed during development. This applies equally when regenerating for an existing PR: rewrite from the current state, not as a log of what changed since the last version. Exception: process details critical to understand a design choice.
- **When commits conflict, trust the final diff**: The commit list is supporting context, not the source of truth. If commits describe intermediate steps later revised or reverted, describe the end state from the full branch diff.
- **Explain the non-obvious**: If the diff is self-explanatory, don't narrate it. Spend space on things the diff doesn't show: why this approach, what was rejected, what the reviewer should watch.
- **Use structure when it earns its keep**: Headers, bullets, and tables aid comprehension, not mandatory template sections.
- **Markdown tables for data**: Before/after comparisons, performance numbers, or option trade-offs communicate well as tables.
- **No empty sections**: If a section doesn't apply, omit it. No "N/A" or "None."
- **Test plan — only when non-obvious**: Include when testing requires edge cases the reviewer wouldn't think of, hard-to-verify behavior, or specific setup. Omit when "run the tests" is the only useful guidance. When the branch adds test files, name them with what they cover.

### Visual communication

Include a visual aid only when the change is structurally complex enough that a reviewer would struggle to reconstruct the mental model from prose alone.

**The core distinction — structure vs. parallel variation:**

- Use a **Mermaid diagram** when the change has **topology** — components with directed relationships (calls, flows, dependencies, state transitions, data paths). Diagrams express "A talks to B, B talks to C, C does not talk back to A" in a way tables cannot.
- Use a **markdown table** when the change has **parallel variation of a single shape** — N things that share the same attributes but differ in their values. Tables express "option 1 costs X, option 2 costs Y, option 3 costs Z" cleanly.

Architecture changes are almost always topology (components + edges), so Mermaid is usually the right call — a table of "components that interact" loses the edges and becomes a flat list. Reserve tables for genuinely parallel data: before/after measurements, option trade-offs, flag matrices, config enumerations.

**When to include (prefer Mermaid, not a table, for architecture/flow):**

| PR changes... | Visual aid |
|---|---|
| Architecture touching 3+ interacting components (the components have *directed relationships* — who calls whom, who owns what, which skill delegates to which) | **Mermaid** component or interaction diagram. Do not substitute a table — tables cannot show edges. |
| Multi-step workflow or data flow with non-obvious sequencing | **Mermaid** flow diagram |
| State machine with 3+ states and non-trivial transitions | **Mermaid** state diagram |
| Data model changes with 3+ related entities | **Mermaid** ERD |
| Before/after performance or behavioral measurements (same metric, different values) | **Markdown table** |
| Option or flag trade-offs (same attributes evaluated across variants) | **Markdown table** |
| Feature matrix / compatibility grid | **Markdown table** |

**When in doubt, ask: "Does the information have edges (A → B) or does it have rows (attribute × variant)?"** Edges → Mermaid. Rows → table. Architecture has edges almost by definition.

**When to skip any visual:**
- Sizing routes to "1-2 sentences"
- Prose already communicates clearly
- The diagram would just restate the diff visually
- Mechanical changes (renames, dep bumps, config, formatting)

**Format details:**
- **Mermaid** (default for topology). 5-10 nodes typical, up to 15 for genuinely complex changes. Use `TB` direction. Source should be readable as fallback.
- **ASCII diagrams** for annotated flows needing rich in-box content. 80-column max.
- **Markdown tables** for parallel-variation data only.
- Place inline at point of relevance, not in a separate section.
- Prose is authoritative when it conflicts with a visual.

Verify generated diagrams against the change before including.

### Numbering and references

Never prefix list items with `#` in PR descriptions — GitHub interprets `#1`, `#2` as issue references and auto-links them.

When referencing actual GitHub issues or PRs, use `org/repo#123` or the full URL. Never use bare `#123` unless verified.

### Applying the focus hint

If a `focus:` hint was provided, incorporate it alongside the diff-derived narrative. Treat focus as steering, not override: do not invent content the diff does not support, and do not suppress important content the diff demands simply because focus did not mention it. When focus and diff materially disagree (e.g., focus says "include benchmarking" but the diff has no benchmarks), note the conflict in a way the caller can see (leave a brief inline note or raise to the caller) rather than fabricating content.

---

## Step 7: Compose the title

Title format: `type: description` or `type(scope): description`.

- **Type** is chosen by intent, not file extension. `feat` for new functionality, `fix` for a bug fix, `refactor` for a behavior-preserving change, `docs` for doc-only, `chore` for tooling/maintenance, `perf` for performance, `test` for test-only.
- **Scope** (optional) is the narrowest useful label: a skill/agent name, CLI area, or shared area. Omit when no single label adds clarity.
- **Description** is imperative, lowercase, under 72 characters total. No trailing period.
- If the repo has commit-title conventions visible in recent commits, match them.

Breaking changes use `!` (e.g., `feat!: ...`) or document in the body with a `BREAKING CHANGE:` footer.

---

## Step 8: Compose the body

Assemble the body in this order:

1. **Opening** -- the narrative frame from Step 4, at the depth chosen in Step 5. Under a heading (e.g., `## Summary`) if the description uses any `##` headings elsewhere; a bare paragraph otherwise.
2. **Body sections** -- only the sections that earn their keep for this change: what changed and why, design decisions, tables for data, visual aids when complexity warrants. Skip empty sections entirely.
3. **Test plan** -- only when non-obvious per the writing principles. Omit otherwise.
4. **Evidence block** -- only the preserved block from Step 3, if one exists. Do not fabricate or placeholder.
5. **Compound Engineering badge** -- append a badge footer separated by a `---` rule. Skip if the existing body (for `pr:` input) already contains the badge.

**Badge:**

```markdown
---

[![Compound Engineering](https://img.shields.io/badge/Built_with-Compound_Engineering-6366f1)](https://github.com/EveryInc/compound-engineering-plugin)
![HARNESS](https://img.shields.io/badge/MODEL_SLUG-COLOR?logo=LOGO&logoColor=white)
```

**Harness lookup:**

| Harness | `LOGO` | `COLOR` |
|---------|--------|---------|
| Claude Code | `claude` | `D97757` |
| Codex | (omit logo param) | `000000` |
| Gemini CLI | `googlegemini` | `4285F4` |

**Model slug:** Replace spaces with underscores. Append context window and thinking level in parentheses if known. Examples: `Opus_4.6_(1M,_Extended_Thinking)`, `Sonnet_4.6_(200K)`, `Gemini_3.1_Pro`.

---

## Step 9: Return `{title, body_file}`

Write the composed body to an OS temp file, then return the title and the file path. Do not call `gh pr edit`, `gh pr create`, or any other mutating command. Do not ask the user to confirm — the caller owns apply.

```bash
BODY_FILE=$(mktemp "${TMPDIR:-/tmp}/ce-pr-body.XXXXXX") && cat > "$BODY_FILE" <<'__CE_PR_BODY_END__' && echo "$BODY_FILE"
<the composed body markdown goes here, verbatim>
__CE_PR_BODY_END__
```

The quoted sentinel `'__CE_PR_BODY_END__'` keeps `$VAR`, backticks, `${...}`, and any literal `EOF` inside the body from being expanded or clashing with the terminator. Keep `echo "$BODY_FILE"` chained with `&&` so a failed `mktemp` or write never yields a success exit status with a path to a missing file.

Format the return as a clearly labeled block the caller can extract cleanly:

```
=== TITLE ===
<title line>

=== BODY_FILE ===
<absolute path to the mktemp body file>
```

Do not emit the body markdown in the return block — the caller reads it from `BODY_FILE`.

If Step 1 exited gracefully (closed/merged PR, invalid range, empty commit list), do not create a body file — just return the reason string.

**The return block is a hand-off, not task completion.** When invoked by a parent skill (e.g., `git-commit-push-pr`), emit the return block and then continue executing the parent's remaining steps (typically `gh pr create` or `gh pr edit` with the returned title and body file). Do not stop after the return block unless invoked directly by the user with no parent workflow.

---

## Cross-platform notes

This skill does not ask questions directly. If the diff is ambiguous about something the caller should decide (e.g., focus conflicts with the actual changes, or evidence is technically capturable but the caller did not pre-stage it), surface the ambiguity in the returned output or a short note to the caller — do not invoke a platform question tool.

Callers that need to ask the user are responsible for using their own platform's blocking question tool (`AskUserQuestion` in Claude Code, `request_user_input` in Codex, `ask_user` in Gemini) before or after invoking this skill.
