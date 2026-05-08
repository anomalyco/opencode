---
name: ce:review
description: "Structured code review using tiered persona agents, confidence-gated findings, and a merge/dedup pipeline. Use when reviewing code changes before creating a PR."
argument-hint: "[blank to review current branch, or provide PR link]"
---

# Code Review

Reviews code changes using dynamically selected reviewer personas. Spawns parallel sub-agents that return structured JSON, then merges and deduplicates findings into a single report.

## When to Use

- Before creating a PR
- After completing a task during iterative implementation
- When feedback is needed on any code changes
- Can be invoked standalone
- Can run as a read-only or autofix review step inside larger workflows

## Argument Parsing

Parse `$ARGUMENTS` for the following optional tokens. Strip each recognized token before interpreting the remainder as the PR number, GitHub URL, or branch name.

| Token | Example | Effect |
|-------|---------|--------|
| `mode:autofix` | `mode:autofix` | Select autofix mode (see Mode Detection below) |
| `mode:report-only` | `mode:report-only` | Select report-only mode |
| `mode:headless` | `mode:headless` | Select headless mode for programmatic callers (see Mode Detection below) |
| `base:<sha-or-ref>` | `base:abc1234` or `base:origin/main` | Skip scope detection — use this as the diff base directly |
| `plan:<path>` | `plan:docs/plans/2026-03-25-001-feat-foo-plan.md` | Load this plan for requirements verification |

All tokens are optional. Each one present means one less thing to infer. When absent, fall back to existing behavior for that stage.

**Conflicting mode flags:** If multiple mode tokens appear in arguments, stop and do not dispatch agents. If `mode:headless` is one of the conflicting tokens, emit the headless error envelope: `Review failed (headless mode). Reason: conflicting mode flags — <mode_a> and <mode_b> cannot be combined.` Otherwise emit the generic form: `Review failed. Reason: conflicting mode flags — <mode_a> and <mode_b> cannot be combined.`

## Mode Detection

| Mode | When | Behavior |
|------|------|----------|
| **Interactive** (default) | No mode token present | Review, apply safe_auto fixes automatically, present findings, ask for policy decisions on gated/manual findings, and optionally continue into fix/push/PR next steps |
| **Autofix** | `mode:autofix` in arguments | No user interaction. Review, apply only policy-allowed `safe_auto` fixes, re-review in bounded rounds, write a run artifact, and emit residual downstream work when needed |
| **Report-only** | `mode:report-only` in arguments | Strictly read-only. Review and report only, then stop with no edits, artifacts, todos, commits, pushes, or PR actions |
| **Headless** | `mode:headless` in arguments | Programmatic mode for skill-to-skill invocation. Apply `safe_auto` fixes silently (single pass), return all other findings as structured text output, write run artifacts, skip todos, and return "Review complete" signal. No interactive prompts. |

### Autofix mode rules

- **Skip all user questions.** Never pause for approval or clarification once scope has been established.
- **Apply only `safe_auto -> review-fixer` findings.** Leave `gated_auto`, `manual`, `human`, and `release` work unresolved.
- **Write a run artifact** under `.context/compound-engineering/ce-review/<run-id>/` summarizing findings, applied fixes, residual actionable work, and advisory outputs.
- **Create durable todo files only for unresolved actionable findings** whose final owner is `downstream-resolver`. Load the `todo-create` skill for the canonical directory path and naming convention.
- **Never commit, push, or create a PR** from autofix mode. Parent workflows own those decisions.

### Report-only mode rules

- **Skip all user questions.** Infer intent conservatively if the diff metadata is thin.
- **Never edit files or externalize work.** Do not write `.context/compound-engineering/ce-review/<run-id>/`, do not create todo files, and do not commit, push, or create a PR.
- **Safe for parallel read-only verification.** `mode:report-only` is the only mode that is safe to run concurrently with browser testing on the same checkout.
- **Do not switch the shared checkout.** If the caller passes an explicit PR or branch target, `mode:report-only` must run in an isolated checkout/worktree or stop instead of running `gh pr checkout` / `git checkout`.
- **Do not overlap mutating review with browser testing on the same checkout.** If a future orchestrator wants fixes, run the mutating review phase after browser testing or in an isolated checkout/worktree.

### Headless mode rules

- **Skip all user questions.** Never use the platform question tool (`AskUserQuestion` in Claude Code, `request_user_input` in Codex, `ask_user` in Gemini) or other interactive prompts. Infer intent conservatively if the diff metadata is thin.
- **Require a determinable diff scope.** If headless mode cannot determine a diff scope (no branch, PR, or `base:` ref determinable without user interaction), emit `Review failed (headless mode). Reason: no diff scope detected. Re-invoke with a branch name, PR number, or base:<ref>.` and stop without dispatching agents.
- **Apply only `safe_auto -> review-fixer` findings in a single pass.** No bounded re-review rounds. Leave `gated_auto`, `manual`, `human`, and `release` work unresolved and return them in the structured output.
- **Return all non-auto findings as structured text output.** Use the headless output envelope format (see Stage 6 below) preserving severity, autofix_class, owner, requires_verification, confidence, pre_existing, and suggested_fix per finding. Enrich with detail-tier fields (why_it_matters, evidence[]) from the per-agent artifact files on disk (see Detail enrichment in Stage 6).
- **Write a run artifact** under `.context/compound-engineering/ce-review/<run-id>/` summarizing findings, applied fixes, and advisory outputs. Include the artifact path in the structured output.
- **Do not create todo files.** The caller receives structured findings and routes downstream work itself.
- **Do not switch the shared checkout.** If the caller passes an explicit PR or branch target, `mode:headless` must run in an isolated checkout/worktree or stop instead of running `gh pr checkout` / `git checkout`. When stopping, emit `Review failed (headless mode). Reason: cannot switch shared checkout. Re-invoke with base:<ref> to review the current checkout, or run from an isolated worktree.`
- **Not safe for concurrent use on a shared checkout.** Unlike `mode:report-only`, headless mutates files (applies `safe_auto` fixes). Callers must not run headless concurrently with other mutating operations on the same checkout.
- **Never commit, push, or create a PR** from headless mode. The caller owns those decisions.
- **End with "Review complete" as the terminal signal** so callers can detect completion. If all reviewers fail or time out, emit `Code review degraded (headless mode). Reason: 0 of N reviewers returned results.` followed by "Review complete".

## Severity Scale

All reviewers use P0-P3:

| Level | Meaning | Action |
|-------|---------|--------|
| **P0** | Critical breakage, exploitable vulnerability, data loss/corruption | Must fix before merge |
| **P1** | High-impact defect likely hit in normal usage, breaking contract | Should fix |
| **P2** | Moderate issue with meaningful downside (edge case, perf regression, maintainability trap) | Fix if straightforward |
| **P3** | Low-impact, narrow scope, minor improvement | User's discretion |

## Action Routing

Severity answers **urgency**. Routing answers **who acts next** and **whether this skill may mutate the checkout**.

| `autofix_class` | Default owner | Meaning |
|-----------------|---------------|---------|
| `safe_auto` | `review-fixer` | Local, deterministic fix suitable for the in-skill fixer when the current mode allows mutation |
| `gated_auto` | `downstream-resolver` or `human` | Concrete fix exists, but it changes behavior, contracts, permissions, or another sensitive boundary that should not be auto-applied by default |
| `manual` | `downstream-resolver` or `human` | Actionable work that should be handed off rather than fixed in-skill |
| `advisory` | `human` or `release` | Report-only output such as learnings, rollout notes, or residual risk |

Routing rules:

- **Synthesis owns the final route.** Persona-provided routing metadata is input, not the last word.
- **Choose the more conservative route on disagreement.** A merged finding may move from `safe_auto` to `gated_auto` or `manual`, but never the other way without stronger evidence.
- **Only `safe_auto -> review-fixer` enters the in-skill fixer queue automatically.**
- **`requires_verification: true` means a fix is not complete without targeted tests, a focused re-review, or operational validation.**

## Reviewers

17 reviewer personas in layered conditionals, plus CE-specific agents. See the persona catalog included below for the full catalog.

**Always-on (every review):**

| Agent | Focus |
|-------|-------|
| `correctness-reviewer` | Logic errors, edge cases, state bugs, error propagation |
| `testing-reviewer` | Coverage gaps, weak assertions, brittle tests |
| `maintainability-reviewer` | Coupling, complexity, naming, dead code, abstraction debt |
| `project-standards-reviewer` | CLAUDE.md and AGENTS.md compliance -- frontmatter, references, naming, portability |
| `agent-native-reviewer` | Verify new features are agent-accessible |
| `learnings-researcher` | Search docs/solutions/ for past issues related to this PR |

**Cross-cutting conditional (selected per diff):**

| Agent | Select when diff touches... |
|-------|---------------------------|
| `security-reviewer` | Auth, public endpoints, user input, permissions |
| `performance-reviewer` | DB queries, data transforms, caching, async |
| `api-contract-reviewer` | Routes, serializers, type signatures, versioning |
| `data-migrations-reviewer` | Migrations, schema changes, backfills |
| `reliability-reviewer` | Error handling, retries, timeouts, background jobs |
| `adversarial-reviewer` | Diff >=50 changed non-test/non-generated/non-lockfile lines, or auth, payments, data mutations, external APIs |
| `cli-readiness-reviewer` | CLI command definitions, argument parsing, CLI framework usage, command handler implementations |
| `previous-comments-reviewer` | Reviewing a PR that has existing review comments or threads |

**Stack-specific conditional (selected per diff):**

| Agent | Select when diff touches... |
|-------|---------------------------|
| `dhh-rails-reviewer` | Rails architecture, service objects, session/auth choices, or Hotwire-vs-SPA boundaries |
| `kieran-rails-reviewer` | Rails application code where conventions, naming, and maintainability are in play |
| `kieran-python-reviewer` | Python modules, endpoints, scripts, or services |
| `kieran-typescript-reviewer` | TypeScript components, services, hooks, utilities, or shared types |
| `julik-frontend-races-reviewer` | Stimulus/Turbo controllers, DOM events, timers, animations, or async UI flows |

**CE conditional (migration-specific):**

| Agent | Select when diff includes migration files |
|-------|------------------------------------------|
| `schema-drift-detector` | Cross-references schema.rb against included migrations |
| `deployment-verification-agent` | Produces deployment checklist with SQL verification queries |

## Review Scope

Every review spawns all 4 always-on personas plus the 2 CE always-on agents, then adds whichever cross-cutting and stack-specific conditionals fit the diff. The model naturally right-sizes: a small config change triggers 0 conditionals = 6 reviewers. A Rails auth feature might trigger security + reliability + kieran-rails + dhh-rails = 10 reviewers.

## Protected Artifacts

The following paths are compound-engineering pipeline artifacts and must never be flagged for deletion, removal, or gitignore by any reviewer:

- `docs/brainstorms/*` -- requirements documents created by ce:brainstorm
- `docs/plans/*.md` -- plan files created by ce:plan (living documents with progress checkboxes)
- `docs/solutions/*.md` -- solution documents created during the pipeline

If a reviewer flags any file in these directories for cleanup or removal, discard that finding during synthesis.

## How to Run

### Stage 1: Determine scope

Compute the diff range, file list, and diff. Minimize permission prompts by combining into as few commands as possible.

**If `base:` argument is provided (fast path):**

The caller already knows the diff base. Skip all base-branch detection, remote resolution, and merge-base computation. Use the provided value directly:

```
BASE_ARG="{base_arg}"
BASE=$(git merge-base HEAD "$BASE_ARG" 2>/dev/null) || BASE="$BASE_ARG"
```

Then produce the same output as the other paths:

```
echo "BASE:$BASE" && echo "FILES:" && git diff --name-only $BASE && echo "DIFF:" && git diff -U10 $BASE && echo "UNTRACKED:" && git ls-files --others --exclude-standard
```

This path works with any ref — a SHA, `origin/main`, a branch name. Automated callers (ce:work, lfg, slfg) should prefer this to avoid the detection overhead. **Do not combine `base:` with a PR number or branch target.** If both are present, stop with an error: "Cannot use `base:` with a PR number or branch target — `base:` implies the current checkout is already the correct branch. Pass `base:` alone, or pass the target alone and let scope detection resolve the base." This avoids scope/intent mismatches where the diff base comes from one source but the code and metadata come from another.

**If a PR number or GitHub URL is provided as an argument:**

If `mode:report-only` or `mode:headless` is active, do **not** run `gh pr checkout <number-or-url>` on the shared checkout. For `mode:report-only`, tell the caller: "mode:report-only cannot switch the shared checkout to review a PR target. Run it from an isolated worktree/checkout for that PR, or run report-only with no target argument on the already checked out branch." For `mode:headless`, emit `Review failed (headless mode). Reason: cannot switch shared checkout. Re-invoke with base:<ref> to review the current checkout, or run from an isolated worktree.` Stop here unless the review is already running in an isolated checkout.

First, verify the worktree is clean before switching branches:

```
git status --porcelain
```

If the output is non-empty, inform the user: "You have uncommitted changes on the current branch. Stash or commit them before reviewing a PR, or use standalone mode (no argument) to review the current branch as-is." Do not proceed with checkout until the worktree is clean.

Then check out the PR branch so persona agents can read the actual code (not the current checkout):

```
gh pr checkout <number-or-url>
```

Then fetch PR metadata. Capture the base branch name and the PR base repository identity, not just the branch name:

```
gh pr view <number-or-url> --json title,body,baseRefName,headRefName,url
```

Use the repository portion of the returned PR URL as `<base-repo>` (for example, `EveryInc/compound-engineering-plugin` from `https://github.com/EveryInc/compound-engineering-plugin/pull/348`).

Then compute a local diff against the PR's base branch so re-reviews also include local fix commits and uncommitted edits. Substitute the PR base branch from metadata (shown here as `<base>`) and the PR base repository identity derived from the PR URL (shown here as `<base-repo>`). Resolve the base ref from the PR's actual base repository, not by assuming `origin` points at that repo:

```
PR_BASE_REMOTE=$(git remote -v | awk 'index($2, "github.com:<base-repo>") || index($2, "github.com/<base-repo>") {print $1; exit}')
if [ -n "$PR_BASE_REMOTE" ]; then PR_BASE_REMOTE_REF="$PR_BASE_REMOTE/<base>"; else PR_BASE_REMOTE_REF=""; fi
PR_BASE_REF=$(git rev-parse --verify "$PR_BASE_REMOTE_REF" 2>/dev/null || git rev-parse --verify <base> 2>/dev/null || true)
if [ -z "$PR_BASE_REF" ]; then
  if [ -n "$PR_BASE_REMOTE_REF" ]; then
    git fetch --no-tags "$PR_BASE_REMOTE" <base>:refs/remotes/"$PR_BASE_REMOTE"/<base> 2>/dev/null || git fetch --no-tags "$PR_BASE_REMOTE" <base> 2>/dev/null || true
    PR_BASE_REF=$(git rev-parse --verify "$PR_BASE_REMOTE_REF" 2>/dev/null || git rev-parse --verify <base> 2>/dev/null || true)
  else
    if git fetch --no-tags https://github.com/<base-repo>.git <base> 2>/dev/null; then
      PR_BASE_REF=$(git rev-parse --verify FETCH_HEAD 2>/dev/null || true)
    fi
    if [ -z "$PR_BASE_REF" ]; then PR_BASE_REF=$(git rev-parse --verify <base> 2>/dev/null || true); fi
  fi
fi
if [ -n "$PR_BASE_REF" ]; then BASE=$(git merge-base HEAD "$PR_BASE_REF" 2>/dev/null) || BASE=""; else BASE=""; fi
```

```
if [ -n "$BASE" ]; then echo "BASE:$BASE" && echo "FILES:" && git diff --name-only $BASE && echo "DIFF:" && git diff -U10 $BASE && echo "UNTRACKED:" && git ls-files --others --exclude-standard; else echo "ERROR: Unable to resolve PR base branch <base> locally. Fetch the base branch and rerun so the review scope stays aligned with the PR."; fi
```

Extract PR title/body, base branch, and PR URL from `gh pr view`, then extract the base marker, file list, diff content, and `UNTRACKED:` list from the local command. Do not use `gh pr diff` as the review scope after checkout -- it only reflects the remote PR state and will miss local fix commits until they are pushed. If the base ref still cannot be resolved from the PR's actual base repository after the fetch attempt, stop instead of falling back to `git diff HEAD`; a PR review without the PR base branch is incomplete.

**If a branch name is provided as an argument:**

Check out the named branch, then diff it against the base branch. Substitute the provided branch name (shown here as `<branch>`).

If `mode:report-only` or `mode:headless` is active, do **not** run `git checkout <branch>` on the shared checkout. For `mode:report-only`, tell the caller: "mode:report-only cannot switch the shared checkout to review another branch. Run it from an isolated worktree/checkout for `<branch>`, or run report-only on the current checkout with no target argument." For `mode:headless`, emit `Review failed (headless mode). Reason: cannot switch shared checkout. Re-invoke with base:<ref> to review the current checkout, or run from an isolated worktree.` Stop here unless the review is already running in an isolated checkout.

First, verify the worktree is clean before switching branches:

```
git status --porcelain
```

If the output is non-empty, inform the user: "You have uncommitted changes on the current branch. Stash or commit them before reviewing another branch, or provide a PR number instead." Do not proceed with checkout until the worktree is clean.

```
git checkout <branch>
```

Then detect the review base branch and compute the merge-base. Run the `references/resolve-base.sh` script, which handles fork-safe remote resolution with multi-fallback detection (PR metadata -> `origin/HEAD` -> `gh repo view` -> common branch names):

```
RESOLVE_OUT=$(bash references/resolve-base.sh) || { echo "ERROR: resolve-base.sh failed"; exit 1; }
if [ -z "$RESOLVE_OUT" ] || echo "$RESOLVE_OUT" | grep -q '^ERROR:'; then echo "${RESOLVE_OUT:-ERROR: resolve-base.sh produced no output}"; exit 1; fi
BASE=$(echo "$RESOLVE_OUT" | sed 's/^BASE://')
```

If the script outputs an error, stop instead of falling back to `git diff HEAD`; a branch review without the base branch would only show uncommitted changes and silently miss all committed work.

On success, produce the diff:

```
echo "BASE:$BASE" && echo "FILES:" && git diff --name-only $BASE && echo "DIFF:" && git diff -U10 $BASE && echo "UNTRACKED:" && git ls-files --others --exclude-standard
```

You may still fetch additional PR metadata with `gh pr view` for title, body, and linked issues, but do not fail if no PR exists.

**If no argument (standalone on current branch):**

Detect the review base branch and compute the merge-base using the same `references/resolve-base.sh` script as branch mode:

```
RESOLVE_OUT=$(bash references/resolve-base.sh) || { echo "ERROR: resolve-base.sh failed"; exit 1; }
if [ -z "$RESOLVE_OUT" ] || echo "$RESOLVE_OUT" | grep -q '^ERROR:'; then echo "${RESOLVE_OUT:-ERROR: resolve-base.sh produced no output}"; exit 1; fi
BASE=$(echo "$RESOLVE_OUT" | sed 's/^BASE://')
```

If the script outputs an error, stop instead of falling back to `git diff HEAD`; a standalone review without the base branch would only show uncommitted changes and silently miss all committed work on the branch.

On success, produce the diff:

```
echo "BASE:$BASE" && echo "FILES:" && git diff --name-only $BASE && echo "DIFF:" && git diff -U10 $BASE && echo "UNTRACKED:" && git ls-files --others --exclude-standard
```

Using `git diff $BASE` (without `..HEAD`) diffs the merge-base against the working tree, which includes committed, staged, and unstaged changes together.

**Untracked file handling:** Always inspect the `UNTRACKED:` list, even when `FILES:`/`DIFF:` are non-empty. Untracked files are outside review scope until staged. If the list is non-empty, tell the user which files are excluded. If any of them should be reviewed, stop and tell the user to `git add` them first and rerun. Only continue when the user is intentionally reviewing tracked changes only. In `mode:headless` or `mode:autofix`, do not stop to ask — proceed with tracked changes only and note the excluded untracked files in the Coverage section of the output.

### Stage 2: Intent discovery

Understand what the change is trying to accomplish. The source of intent depends on which Stage 1 path was taken:

**PR/URL mode:** Use the PR title, body, and linked issues from `gh pr view` metadata. Supplement with commit messages from the PR if the body is sparse.

**Branch mode:** Run `git log --oneline ${BASE}..<branch>` using the resolved merge-base from Stage 1.

**Standalone (current branch):** Run:

```
echo "BRANCH:" && git rev-parse --abbrev-ref HEAD && echo "COMMITS:" && git log --oneline ${BASE}..HEAD
```

Combined with conversation context (plan section summary, PR description), write a 2-3 line intent summary:

```
Intent: Simplify tax calculation by replacing the multi-tier rate lookup
with a flat-rate computation. Must not regress edge cases in tax-exempt handling.
```

Pass this to every reviewer in their spawn prompt. Intent shapes *how hard each reviewer looks*, not which reviewers are selected.

**When intent is ambiguous:**

- **Interactive mode:** Ask one question using the platform's interactive question tool (AskUserQuestion in Claude Code, request_user_input in Codex): "What is the primary goal of these changes?" Do not spawn reviewers until intent is established.
- **Autofix/report-only/headless modes:** Infer intent conservatively from the branch name, diff, PR metadata, and caller context. Note the uncertainty in Coverage or Verdict reasoning instead of blocking.

### Stage 2b: Plan discovery (requirements verification)

Locate the plan document so Stage 6 can verify requirements completeness. Check these sources in priority order — stop at the first hit:

1. **`plan:` argument.** If the caller passed a plan path, use it directly. Read the file to confirm it exists.
2. **PR body.** If PR metadata was fetched in Stage 1, scan the body for paths matching `docs/plans/*.md`. If exactly one match is found and the file exists, use it as `plan_source: explicit`. If multiple plan paths appear, treat as ambiguous — demote to `plan_source: inferred` for the most recent match that exists on disk, or skip if none exist or none clearly relate to the PR title/intent. Always verify the selected file exists before using it — stale or copied plan links in PR descriptions are common.
3. **Auto-discover.** Extract 2-3 keywords from the branch name (e.g., `feat/onboarding-skill` -> `onboarding`, `skill`). Glob `docs/plans/*` and filter filenames containing those keywords. If exactly one match, use it. If multiple matches or the match looks ambiguous (e.g., generic keywords like `review`, `fix`, `update` that could hit many plans), **skip auto-discovery** — a wrong plan is worse than no plan. If zero matches, skip.

**Confidence tagging:** Record how the plan was found:
- `plan:` argument -> `plan_source: explicit` (high confidence)
- Single unambiguous PR body match -> `plan_source: explicit` (high confidence)
- Multiple/ambiguous PR body matches -> `plan_source: inferred` (lower confidence)
- Auto-discover with single unambiguous match -> `plan_source: inferred` (lower confidence)

If a plan is found, read its **Requirements Trace** (R1, R2, etc.) and **Implementation Units** (checkbox items). Store the extracted requirements list and `plan_source` for Stage 6. Do not block the review if no plan is found — requirements verification is additive, not required.

### Stage 3: Select reviewers

Read the diff and file list from Stage 1. The 4 always-on personas and 2 CE always-on agents are automatic. For each cross-cutting and stack-specific conditional persona in the persona catalog included below, decide whether the diff warrants it. This is agent judgment, not keyword matching.

**File-type awareness for conditional selection:** Instruction-prose files (Markdown skill definitions, JSON schemas, config files) are product code but do not benefit from runtime-focused reviewers. The adversarial reviewer's techniques (race conditions, cascade failures, abuse cases) target executable code behavior. For diffs that only change instruction-prose files, skip adversarial unless the prose describes auth, payment, or data-mutation behavior. Count only executable code lines toward line-count thresholds.

**`previous-comments` is PR-only.** Only select this persona when Stage 1 gathered PR metadata (PR number or URL was provided as an argument, or `gh pr view` returned metadata for the current branch). Skip it entirely for standalone branch reviews with no associated PR -- there are no prior comments to check.

Stack-specific personas are additive. A Rails UI change may warrant `kieran-rails` plus `julik-frontend-races`; a TypeScript API diff may warrant `kieran-typescript` plus `api-contract` and `reliability`.

For CE conditional agents, check if the diff includes files matching `db/migrate/*.rb`, `db/schema.rb`, or data backfill scripts.

Announce the team before spawning:

```
Review team:
- correctness (always)
- testing (always)
- maintainability (always)
- project-standards (always)
- agent-native-reviewer (always)
- learnings-researcher (always)
- security -- new endpoint in routes.rb accepts user-provided redirect URL
- kieran-rails -- controller and Turbo flow changed in app/controllers and app/views
- dhh-rails -- diff adds service objects around ordinary Rails CRUD
- data-migrations -- adds migration 20260303_add_index_to_orders
- schema-drift-detector -- migration files present
```

This is progress reporting, not a blocking confirmation.

### Stage 3b: Discover project standards paths

Before spawning sub-agents, find the file paths (not contents) of all relevant standards files for the `project-standards` persona. Use the native file-search/glob tool to locate:

1. Use the native file-search tool (e.g., Glob in Claude Code) to find all `**/CLAUDE.md` and `**/AGENTS.md` in the repo.
2. Filter to those whose directory is an ancestor of at least one changed file. A standards file governs all files below it (e.g., `plugins/compound-engineering/AGENTS.md` applies to everything under `plugins/compound-engineering/`).

Pass the resulting path list to the `project-standards` persona inside a `<standards-paths>` block in its review context (see Stage 4). The persona reads the files itself, targeting only the sections relevant to the changed file types. This keeps the orchestrator's work cheap (path discovery only) and avoids bloating the subagent prompt with content the reviewer may not fully need.

### Stage 4: Spawn sub-agents

#### Model tiering

Persona sub-agents do focused, scoped work and should use a fast mid-tier model to reduce cost and latency without sacrificing review quality. The orchestrator itself stays on the default (most capable) model.

Use the platform's mid-tier model for all persona and CE sub-agents. In Claude Code, pass `model: "sonnet"` in the Agent tool call. On other platforms, use the equivalent mid-tier (e.g., `gpt-4o` in Codex). If the platform has no model override mechanism or the available model names are unknown, omit the model parameter and let agents inherit the default -- a working review on the parent model is better than a broken dispatch from an unrecognized model name.

CE always-on agents (agent-native-reviewer, learnings-researcher) and CE conditional agents (schema-drift-detector, deployment-verification-agent) also use the mid-tier model since they perform scoped, focused work.

The orchestrator (this skill) stays on the default model because it handles intent discovery, reviewer selection, finding merge/dedup, and synthesis -- tasks that benefit from stronger reasoning.

#### Run ID

Generate a unique run identifier before dispatching any agents. This ID scopes all agent artifact files and the post-review run artifact to the same directory.

```bash
RUN_ID=$(date +%Y%m%d-%H%M%S)-$(head -c4 /dev/urandom | od -An -tx1 | tr -d ' ')
mkdir -p ".context/compound-engineering/ce-review/$RUN_ID"
```

Pass `{run_id}` to every persona sub-agent so they can write their full analysis to `.context/compound-engineering/ce-review/{run_id}/{reviewer_name}.json`.

**Report-only mode:** Skip run-id generation and directory creation. Do not pass `{run_id}` to agents. Agents return compact JSON only with no file write, consistent with report-only's no-write contract.

#### Spawning

Omit the `mode` parameter when dispatching sub-agents so the user's configured permission settings apply. Do not pass `mode: "auto"`.

Spawn each selected persona reviewer as a parallel sub-agent using the subagent template included below. Each persona sub-agent receives:

1. Their persona file content (identity, failure modes, calibration, suppress conditions)
2. Shared diff-scope rules from the diff-scope reference included below
3. The JSON output contract from the findings schema included below
4. PR metadata: title, body, and URL when reviewing a PR (empty string otherwise). Passed in a `<pr-context>` block so reviewers can verify code against stated intent
5. Review context: intent summary, file list, diff
6. Run ID and reviewer name for the artifact file path
7. **For `project-standards` only:** the standards file path list from Stage 3b, wrapped in a `<standards-paths>` block appended to the review context

Persona sub-agents are **read-only** with respect to the project: they review and return structured JSON. They do not edit project files or propose refactors. The one permitted write is saving their full analysis to the `.context/` artifact path specified in the output contract.

Read-only here means **non-mutating**, not "no shell access." Reviewer sub-agents may use non-mutating inspection commands when needed to gather evidence or verify scope, including read-oriented `git` / `gh` usage such as `git diff`, `git show`, `git blame`, `git log`, and `gh pr view`. They must not edit project files, change branches, commit, push, create PRs, or otherwise mutate the checkout or repository state.

Each persona sub-agent writes full JSON (all schema fields) to `.context/compound-engineering/ce-review/{run_id}/{reviewer_name}.json` and returns compact JSON with merge-tier fields only:

```json
{
  "reviewer": "security",
  "findings": [
    {
      "title": "User-supplied ID in account lookup without ownership check",
      "severity": "P0",
      "file": "orders_controller.rb",
      "line": 42,
      "confidence": 0.92,
      "autofix_class": "gated_auto",
      "owner": "downstream-resolver",
      "requires_verification": true,
      "pre_existing": false,
      "suggested_fix": "Add current_user.owns?(account) guard before lookup"
    }
  ],
  "residual_risks": [...],
  "testing_gaps": [...]
}
```

Detail-tier fields (`why_it_matters`, `evidence`) are in the artifact file only. `suggested_fix` is optional in both tiers -- included in compact returns when present so the orchestrator has fix context for auto-apply decisions. If the file write fails, the compact return still provides everything the merge needs.

**CE always-on agents** (agent-native-reviewer, learnings-researcher) are dispatched as standard Agent calls in parallel with the persona agents. Give them the same review context bundle the personas receive: entry mode, any PR metadata gathered in Stage 1, intent summary, review base branch name when known, `BASE:` marker, file list, diff, and `UNTRACKED:` scope notes. Do not invoke them with a generic "review this" prompt. Their output is unstructured and synthesized separately in Stage 6.

**CE conditional agents** (schema-drift-detector, deployment-verification-agent) are also dispatched as standard Agent calls when applicable. Pass the same review context bundle plus the applicability reason (for example, which migration files triggered the agent). For schema-drift-detector specifically, pass the resolved review base branch explicitly so it never assumes `main`. Their output is unstructured and must be preserved for Stage 6 synthesis just like the CE always-on agents.

### Stage 5: Merge findings

Convert multiple reviewer compact JSON returns into one deduplicated, confidence-gated finding set. The compact returns contain merge-tier fields (title, severity, file, line, confidence, autofix_class, owner, requires_verification, pre_existing) plus the optional suggested_fix. Detail-tier fields (why_it_matters, evidence) are on disk in the per-agent artifact files and are not loaded at this stage.

1. **Validate.** Check each compact return for required top-level and per-finding fields, plus value constraints. Drop malformed returns or findings. Record the drop count.
   - **Top-level required:** reviewer (string), findings (array), residual_risks (array), testing_gaps (array). Drop the entire return if any are missing or wrong type.
   - **Per-finding required:** title, severity, file, line, confidence, autofix_class, owner, requires_verification, pre_existing
   - **Value constraints:**
     - severity: P0 | P1 | P2 | P3
     - autofix_class: safe_auto | gated_auto | manual | advisory
     - owner: review-fixer | downstream-resolver | human | release
     - confidence: numeric, 0.0-1.0
     - line: positive integer
     - pre_existing, requires_verification: boolean
   - Do not validate against the full schema here -- the full schema (including why_it_matters and evidence) applies to the artifact files on disk, not the compact returns.
2. **Confidence gate.** Suppress findings below 0.60 confidence. Exception: P0 findings at 0.50+ confidence survive the gate -- critical-but-uncertain issues must not be silently dropped. Record the suppressed count. This matches the persona instructions and the schema's confidence thresholds.
3. **Deduplicate.** Compute fingerprint: `normalize(file) + line_bucket(line, +/-3) + normalize(title)`. When fingerprints match, merge: keep highest severity, keep highest confidence, note which reviewers flagged it.
4. **Cross-reviewer agreement.** When 2+ independent reviewers flag the same issue (same fingerprint), boost the merged confidence by 0.10 (capped at 1.0). Cross-reviewer agreement is strong signal -- independent reviewers converging on the same issue is more reliable than any single reviewer's confidence. Note the agreement in the Reviewer column of the output (e.g., "security, correctness").
5. **Separate pre-existing.** Pull out findings with `pre_existing: true` into a separate list.
6. **Resolve disagreements.** When reviewers flag the same code region but disagree on severity, autofix_class, or owner, annotate the Reviewer column with the disagreement (e.g., "security (P0), correctness (P1) -- kept P0"). This transparency helps the user understand why a finding was routed the way it was.
7. **Normalize routing.** For each merged finding, set the final `autofix_class`, `owner`, and `requires_verification`. If reviewers disagree, keep the most conservative route. Synthesis may narrow a finding from `safe_auto` to `gated_auto` or `manual`, but must not widen it without new evidence.
8. **Partition the work.** Build three sets:
   - in-skill fixer queue: only `safe_auto -> review-fixer`
   - residual actionable queue: unresolved `gated_auto` or `manual` findings whose owner is `downstream-resolver`
   - report-only queue: `advisory` findings plus anything owned by `human` or `release`
9. **Sort.** Order by severity (P0 first) -> confidence (descending) -> file path -> line number.
10. **Collect coverage data.** Union residual_risks and testing_gaps across reviewers.
11. **Preserve CE agent artifacts.** Keep the learnings, agent-native, schema-drift, and deployment-verification outputs alongside the merged finding set. Do not drop unstructured agent output just because it does not match the persona JSON schema.

### Stage 6: Synthesize and present

Assemble the final report using **pipe-delimited markdown tables for findings** from the review output template included below. The table format is mandatory for finding rows in interactive mode — do not render findings as freeform text blocks or horizontal-rule-separated prose. Other report sections (Applied Fixes, Learnings, Coverage, etc.) use bullet lists and the `---` separator before the verdict, as shown in the template.

1. **Header.** Scope, intent, mode, reviewer team with per-conditional justifications.
2. **Findings.** Rendered as pipe-delimited tables grouped by severity (`### P0 -- Critical`, `### P1 -- High`, `### P2 -- Moderate`, `### P3 -- Low`). Each finding row shows `#`, file, issue, reviewer(s), confidence, and synthesized route. Omit empty severity levels. Never render findings as freeform text blocks or numbered lists.
3. **Requirements Completeness.** Include only when a plan was found in Stage 2b. For each requirement (R1, R2, etc.) and implementation unit in the plan, report whether corresponding work appears in the diff. Use a simple checklist: met / not addressed / partially addressed. Routing depends on `plan_source`:
   - **`explicit`** (caller-provided or PR body): Flag unaddressed requirements as P1 findings with `autofix_class: manual`, `owner: downstream-resolver`. These enter the residual actionable queue and can become todos.
   - **`inferred`** (auto-discovered): Flag unaddressed requirements as P3 findings with `autofix_class: advisory`, `owner: human`. These stay in the report only — no todos, no autonomous follow-up. An inferred plan match is a hint, not a contract.
   Omit this section entirely when no plan was found — do not mention the absence of a plan.
4. **Applied Fixes.** Include only if a fix phase ran in this invocation.
5. **Residual Actionable Work.** Include when unresolved actionable findings were handed off or should be handed off.
6. **Pre-existing.** Separate section, does not count toward verdict.
7. **Learnings & Past Solutions.** Surface learnings-researcher results: if past solutions are relevant, flag them as "Known Pattern" with links to docs/solutions/ files.
8. **Agent-Native Gaps.** Surface agent-native-reviewer results. Omit section if no gaps found.
9. **Schema Drift Check.** If schema-drift-detector ran, summarize whether drift was found. If drift exists, list the unrelated schema objects and the required cleanup command. If clean, say so briefly.
10. **Deployment Notes.** If deployment-verification-agent ran, surface the key Go/No-Go items: blocking pre-deploy checks, the most important verification queries, rollback caveats, and monitoring focus areas. Keep the checklist actionable rather than dropping it into Coverage.
11. **Coverage.** Suppressed count, residual risks, testing gaps, failed/timed-out reviewers, and any intent uncertainty carried by non-interactive modes.
12. **Verdict.** Ready to merge / Ready with fixes / Not ready. Fix order if applicable. When an `explicit` plan has unaddressed requirements, the verdict must reflect it — a PR that's code-clean but missing planned requirements is "Not ready" unless the omission is intentional. When an `inferred` plan has unaddressed requirements, note it in the verdict reasoning but do not block on it alone.

Do not include time estimates.

**Format verification:** Before delivering the report, verify the findings sections use pipe-delimited table rows (`| # | File | Issue | ... |`) not freeform text. If you catch yourself rendering findings as prose blocks separated by horizontal rules or bullet points, stop and reformat into tables.

### Headless output format

In `mode:headless`, replace the interactive pipe-delimited table report with a structured text envelope. The envelope follows the same structural pattern as document-review's headless output (completion header, metadata block, findings grouped by autofix_class, trailing sections) while using ce:review's own section headings and per-finding fields.

```
Code review complete (headless mode).

Scope: <scope-line>
Intent: <intent-summary>
Reviewers: <reviewer-list with conditional justifications>
Verdict: <Ready to merge | Ready with fixes | Not ready>
Artifact: .context/compound-engineering/ce-review/<run-id>/

Applied N safe_auto fixes.

Gated-auto findings (concrete fix, changes behavior/contracts):

[P1][gated_auto -> downstream-resolver][needs-verification] File: <file:line> -- <title> (<reviewer>, confidence <N>)
  Why: <why_it_matters>
  Suggested fix: <suggested_fix or "none">
  Evidence: <evidence[0]>
  Evidence: <evidence[1]>

Manual findings (actionable, needs handoff):

[P1][manual -> downstream-resolver] File: <file:line> -- <title> (<reviewer>, confidence <N>)
  Why: <why_it_matters>
  Evidence: <evidence[0]>

Advisory findings (report-only):

[P2][advisory -> human] File: <file:line> -- <title> (<reviewer>, confidence <N>)
  Why: <why_it_matters>

Pre-existing issues:
[P2][gated_auto -> downstream-resolver] File: <file:line> -- <title> (<reviewer>, confidence <N>)
  Why: <why_it_matters>

Residual risks:
- <risk>

Learnings & Past Solutions:
- <learning>

Agent-Native Gaps:
- <gap description>

Schema Drift Check:
- <drift status>

Deployment Notes:
- <deployment note>

Testing gaps:
- <gap>

Coverage:
- Suppressed: <N> findings below 0.60 confidence (P0 at 0.50+ retained)
- Untracked files excluded: <file1>, <file2>
- Failed reviewers: <reviewer>

Review complete
```

**Detail enrichment (headless only):** The headless envelope includes `Why:`, `Evidence:`, and `Suggested fix:` lines. After merge (Stage 5), read the per-agent artifact files from `.context/compound-engineering/ce-review/{run_id}/` for only the findings that survived dedup and confidence gating.
   - **Field tiers:** `Why:` and `Evidence:` are detail-tier -- load from per-agent artifact files. `Suggested fix:` is merge-tier -- use it directly from the compact return without artifact lookup.
   - **Artifact matching:** For each surviving finding, look up its detail-tier fields in the artifact files of the contributing reviewers. Match on `file + line_bucket(line, +/-3)` (the same tolerance used in Stage 5 dedup) within each contributing reviewer's artifact. When multiple artifact entries fall within the line bucket, apply `normalize(title)` to both the merged finding's title and each candidate entry's title as a tie-breaker.
   - **Reviewer order:** Try contributing reviewers in the order they appear in the merged finding's reviewer list; use the first match.
   - **No-match fallback:** If no artifact file contains a match (all writes failed, or the finding was synthesized during merge), omit the `Why:` and `Evidence:` lines for that finding and note the gap in Coverage. The `Suggested fix:` line can still be populated from the compact return since it is merge-tier.

**Formatting rules:**
- The `[needs-verification]` marker appears only on findings where `requires_verification: true`.
- The `Artifact:` line gives callers the path to the full run artifact for machine-readable access to the complete findings schema. The text envelope is the primary handoff; the artifact is for debugging and full-fidelity access.
- Findings with `owner: release` appear in the Advisory section (they are operational/rollout items, not code fixes).
- Findings with `pre_existing: true` appear in the Pre-existing section regardless of autofix_class.
- The Verdict appears in the metadata header (deliberately reordered from the interactive format where it appears at the bottom) so programmatic callers get the verdict first.
- Omit any section with zero items.
- If all reviewers fail or time out, emit `Code review degraded (headless mode). Reason: 0 of N reviewers returned results.` followed by "Review complete".
- End with "Review complete" as the terminal signal so callers can detect completion.

## Quality Gates

Before delivering the review, verify:

1. **Every finding is actionable.** Re-read each finding. If it says "consider", "might want to", or "could be improved" without a concrete fix, rewrite it with a specific action. Vague findings waste engineering time.
2. **No false positives from skimming.** For each finding, verify the surrounding code was actually read. Check that the "bug" isn't handled elsewhere in the same function, that the "unused import" isn't used in a type annotation, that the "missing null check" isn't guarded by the caller.
3. **Severity is calibrated.** A style nit is never P0. A SQL injection is never P3. Re-check every severity assignment.
4. **Line numbers are accurate.** Verify each cited line number against the file content. A finding pointing to the wrong line is worse than no finding.
5. **Protected artifacts are respected.** Discard any findings that recommend deleting or gitignoring files in `docs/brainstorms/`, `docs/plans/`, or `docs/solutions/`.
6. **Findings don't duplicate linter output.** Don't flag things the project's linter/formatter would catch (missing semicolons, wrong indentation). Focus on semantic issues.

## Language-Aware Conditionals

This skill uses stack-specific reviewer agents when the diff clearly warrants them. Keep those agents opinionated. They are not generic language checkers; they add a distinct review lens on top of the always-on and cross-cutting personas.

Do not spawn them mechanically from file extensions alone. The trigger is meaningful changed behavior, architecture, or UI state in that stack.

## After Review

### Mode-Driven Post-Review Flow

After presenting findings and verdict (Stage 6), route the next steps by mode. Review and synthesis stay the same in every mode; only mutation and handoff behavior changes.

#### Step 1: Build the action sets

- **Clean review** means zero findings after suppression and pre-existing separation. Skip the fix/handoff phase when the review is clean.
- **Fixer queue:** final findings routed to `safe_auto -> review-fixer`.
- **Residual actionable queue:** unresolved `gated_auto` or `manual` findings whose final owner is `downstream-resolver`.
- **Report-only queue:** `advisory` findings and any outputs owned by `human` or `release`.
- **Never convert advisory-only outputs into fix work or todos.** Deployment notes, residual risks, and release-owned items stay in the report.

#### Step 2: Choose policy by mode

**Interactive mode**

- Apply `safe_auto -> review-fixer` findings automatically without asking. These are safe by definition.
- Ask a policy question **using the platform's blocking question tool** (`AskUserQuestion` in Claude Code, `request_user_input` in Codex, `ask_user` in Gemini) only when `gated_auto` or `manual` findings remain after safe fixes. Do not replace with a conversational open-ended question. Adapt the options to match what actually remains:

  **When `gated_auto` findings are present** (with or without `manual`):
  ```
  Safe fixes have been applied. What should I do with the remaining findings?
  1. Review and approve specific gated fixes (Recommended)
  2. Leave as residual work
  3. Report only -- no further action
  ```

  **When only `manual` findings remain** (no `gated_auto`):
  ```
  Safe fixes have been applied. The remaining findings need manual resolution. What should I do?
  1. Leave as residual work (Recommended)
  2. Report only -- no further action
  ```

  If no blocking question tool is available, present the applicable numbered options as text and wait for the user's selection before proceeding.
- If no `gated_auto` or `manual` findings remain after safe fixes, skip the policy question entirely — report what was fixed and proceed to next steps.
- Only include `gated_auto` findings in the fixer queue after the user explicitly approves the specific items. Do not widen the queue based on severity alone.

**Autofix mode**

- Ask no questions.
- Apply only the `safe_auto -> review-fixer` queue.
- Leave `gated_auto`, `manual`, `human`, and `release` items unresolved.
- Prepare residual work only for unresolved actionable findings whose final owner is `downstream-resolver`.

**Report-only mode**

- Ask no questions.
- Do not build a fixer queue.
- Do not create residual todos or `.context` artifacts.
- Stop after Stage 6. Everything remains in the report.

**Headless mode**

- Ask no questions.
- Apply only the `safe_auto -> review-fixer` queue in a single pass. Do not enter the bounded re-review loop (Step 3). Spawn one fixer subagent, apply fixes, then proceed directly to Step 4.
- Leave `gated_auto`, `manual`, `human`, and `release` items unresolved — they appear in the structured text output.
- Output the headless output envelope (see Stage 6) instead of the interactive report.
- Write a run artifact (Step 4) but do not create todo files.
- Stop after the structured text output and "Review complete" signal. No commit/push/PR.

#### Step 3: Apply fixes with one fixer and bounded rounds

- Spawn exactly one fixer subagent for the current fixer queue in the current checkout. That fixer applies all approved changes and runs the relevant targeted tests in one pass against a consistent tree.
- Do not fan out multiple fixers against the same checkout. Parallel fixers require isolated worktrees/branches and deliberate mergeback.
- Re-review only the changed scope after fixes land.
- Bound the loop with `max_rounds: 2`. If issues remain after the second round, stop and hand them off as residual work or report them as unresolved.
- If any applied finding has `requires_verification: true`, the round is incomplete until the targeted verification runs.
- Do not start a mutating review round concurrently with browser testing on the same checkout. Future orchestrators that want both must either run `mode:report-only` during the parallel phase or isolate the mutating review in its own checkout/worktree.

#### Step 4: Emit artifacts and downstream handoff

- In interactive, autofix, and headless modes, write a per-run artifact under `.context/compound-engineering/ce-review/<run-id>/` containing:
  - synthesized findings (merged output from Stage 5)
  - applied fixes
  - residual actionable work
  - advisory-only outputs
  Per-agent full-detail JSON files (`{reviewer_name}.json`) are already present in this directory from Stage 4 dispatch.
- Also write `metadata.json` alongside the findings so downstream skills (e.g., `ce:polish-beta`) can verify the artifact matches the current branch and HEAD. Minimum fields:
  ```json
  {
    "run_id": "<run-id>",
    "branch": "<git branch --show-current at dispatch time>",
    "head_sha": "<git rev-parse HEAD at dispatch time>",
    "verdict": "<Ready to merge | Ready with fixes | Not ready>",
    "completed_at": "<ISO 8601 UTC timestamp>"
  }
  ```
  Capture `branch` and `head_sha` at dispatch time (before any autofixes land), and write the file after the verdict is finalized. This file is additive -- pre-existing artifacts that predate this field are still valid, and downstream skills fall back to file mtime when it is missing.
- In autofix mode, create durable todo files only for unresolved actionable findings whose final owner is `downstream-resolver`. Load the `todo-create` skill for the canonical directory path, naming convention, YAML frontmatter structure, and template. Each todo should map the finding's severity to the todo priority (`P0`/`P1` -> `p1`, `P2` -> `p2`, `P3` -> `p3`) and set `status: ready` since these findings have already been triaged by synthesis.
- Do not create todos for `advisory` findings, `owner: human`, `owner: release`, or protected-artifact cleanup suggestions.
- If only advisory outputs remain, create no todos.
- Interactive mode may offer to externalize residual actionable work after fixes, but it is not required to finish the review.

#### Step 5: Final next steps

**Interactive mode only:** after the fix-review cycle completes (clean verdict or the user chose to stop), offer next steps based on the entry mode. Reuse the resolved review base/default branch from Stage 1 when known; do not hard-code only `main`/`master`.

- **PR mode (entered via PR number/URL):**
  - **Push fixes** -- push commits to the existing PR branch
  - **Exit** -- done for now
- **Branch mode (feature branch with no PR, and not the resolved review base/default branch):**
  - **Create a PR (Recommended)** -- push and open a pull request
  - **Continue without PR** -- stay on the branch
  - **Exit** -- done for now
- **On the resolved review base/default branch:**
  - **Continue** -- proceed with next steps
  - **Exit** -- done for now

If "Create a PR": first publish the branch with `git push --set-upstream origin HEAD`, then use `gh pr create` with a title and summary derived from the branch changes.
If "Push fixes": push the branch with `git push` to update the existing PR.

**Autofix, report-only, and headless modes:** stop after the report, artifact emission, and residual-work handoff. Do not commit, push, or create a PR.

## Fallback

If the platform doesn't support parallel sub-agents, run reviewers sequentially. Everything else (stages, output format, merge pipeline) stays the same.

---

## Included References

### Persona Catalog

@./references/persona-catalog.md

### Subagent Template

@./references/subagent-template.md

### Diff Scope Rules

@./references/diff-scope.md

### Findings Schema

@./references/findings-schema.json

### Review Output Template

@./references/review-output-template.md
