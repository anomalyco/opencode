---
name: ce-code-review
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

## Quick Review Short-Circuit

If `$ARGUMENTS` indicates the user wants a quick, fast, or light code review, do not dispatch the multi-agent flow.

**Announce the chosen path** before any other work (Quick review vs Multi-agent review).

Programmatic callers (when `mode:autofix`, `mode:report-only`, or `mode:headless` is present) skip this announcement -- the orchestrator owns user-facing messaging.

Sequence:

1. **Run the harness's built-in code review.** If `$ARGUMENTS` contained a review target (PR number, GitHub URL, or branch name) after stripping recognized tokens, forward that target to the built-in. If no target was provided, run the bare command and let the built-in default to the current branch.
   - If you are Claude Code, run the `/review` tool, passing the target if present (e.g., `/review 123`, `/review <PR-URL>`, `/review <branch>`); otherwise run bare `/review`.
   - If you are Gemini, run a quick code review against the resolved target (or the current branch when none was provided).
   - For all other coding harnesses, run your built-in code review tool, forwarding the target when its syntax accepts one.

   Then stop. Do not dispatch the multi-agent reviewer pipeline.

2. **Exemption -- no built-in code review exists.** If the current harness has no built-in code review command or skill, do not short-circuit. Continue into the full multi-agent review described in the rest of this skill (Tier 2).

3. **Programmatic callers bypass this short-circuit.** When `mode:autofix`, `mode:report-only`, or `mode:headless` is present, ignore quick intent and run the full multi-agent review. Skill-to-skill callers that want the lightweight pass should invoke `/review` (or the harness equivalent) directly rather than route through this short-circuit.

## Mode Detection

| Mode | When | Behavior |
|------|------|----------|
| **Interactive** (default) | No mode token present | Review, apply safe_auto fixes automatically, present findings, ask for policy decisions on gated/manual findings, and optionally continue into fix/push/PR next steps |
| **Autofix** | `mode:autofix` in arguments | No user interaction. Review, apply only policy-allowed `safe_auto` fixes, re-review in bounded rounds, write a run artifact capturing residual downstream work |
| **Report-only** | `mode:report-only` in arguments | Strictly read-only. Review and report only, then stop with no edits, artifacts, commits, pushes, or PR actions |
| **Headless** | `mode:headless` in arguments | Programmatic mode for skill-to-skill invocation. Apply `safe_auto` fixes silently (single pass), return all other findings as structured text output, write run artifacts, and return "Review complete" signal. No interactive prompts. |

### Autofix mode rules

- **Skip all user questions.** Never pause for approval or clarification once scope has been established.
- **Apply only `safe_auto -> review-fixer` findings.** Leave `gated_auto`, `manual`, `human`, and `release` work unresolved.
- **Write a run artifact** under `/tmp/compound-engineering/ce-code-review/<run-id>/` summarizing findings, applied fixes, residual actionable work, and advisory outputs. Orchestrators read this artifact to route residual `downstream-resolver` findings; the skill itself does not file tickets or prompt the user in autofix.
- **Emit a compact Residual Actionable Work summary in the autofix return** listing each residual `downstream-resolver` finding with its stable `#`, severity, file:line, title, and autofix_class. Structure the summary as two separate contiguous sections: applied `safe_auto` fixes first, then residual non-auto findings. Within the residual section, reuse each finding's stable `#` from Stage 5 -- never renumber. Include the run-artifact path. Callers read this summary directly without parsing the artifact. When no residuals exist, state `Residual actionable work: none.` explicitly.
- **Never commit, push, or create a PR** from autofix mode. Parent workflows own those decisions.

### Report-only mode rules

- **Skip all user questions.** Infer intent conservatively if the diff metadata is thin.
- **Never edit files or externalize work.** Do not write `/tmp/compound-engineering/ce-code-review/<run-id>/`, do not file tickets, and do not commit, push, or create a PR.
- **Safe for parallel read-only verification.** `mode:report-only` is the only mode that is safe to run concurrently with browser testing on the same checkout.
- **Do not switch the shared checkout.** If the caller passes an explicit PR or branch target, `mode:report-only` must run in an isolated checkout/worktree or stop instead of running `gh pr checkout` / `git checkout`.
- **Do not overlap mutating review with browser testing on the same checkout.** If a future orchestrator wants fixes, run the mutating review phase after browser testing or in an isolated checkout/worktree.

### Headless mode rules

- **Skip all user questions.** Never use the platform question tool (`AskUserQuestion` in Claude Code, `request_user_input` in Codex, `ask_user` in Gemini, `ask_user` in Pi (requires the `pi-ask-user` extension)) or other interactive prompts. Infer intent conservatively if the diff metadata is thin.
- **Require a determinable diff scope.** If headless mode cannot determine a diff scope (no branch, PR, or `base:` ref determinable without user interaction), emit `Review failed (headless mode). Reason: no diff scope detected. Re-invoke with a branch name, PR number, or base:<ref>.` and stop without dispatching agents.
- **Apply only `safe_auto -> review-fixer` findings in a single pass.** No bounded re-review rounds. Leave `gated_auto`, `manual`, `human`, and `release` work unresolved and return them in the structured output.
- **Return all non-auto findings as structured text output.** Use the headless output envelope format (see Stage 6 below) preserving severity, autofix_class, owner, requires_verification, confidence, pre_existing, and suggested_fix per finding. Enrich with detail-tier fields (why_it_matters, evidence[]) from the per-agent artifact files on disk (see Detail enrichment in Stage 6).
- **Write a run artifact** under `/tmp/compound-engineering/ce-code-review/<run-id>/` summarizing findings, applied fixes, and advisory outputs. Include the artifact path in the structured output.
- **Do not file tickets or externalize work.** The caller receives structured findings and routes downstream work itself.
- **Do not switch the shared checkout.** If the caller passes an explicit PR or branch target, `mode:headless` must run in an isolated checkout/worktree or stop instead of running `gh pr checkout` / `git checkout`. When stopping, emit `Review failed (headless mode). Reason: cannot switch shared checkout. Re-invoke with base:<ref> to review the current checkout, or run from an isolated worktree.`
- **Not safe for concurrent use on a shared checkout.** Unlike `mode:report-only`, headless mutates files (applies `safe_auto` fixes). Callers must not run headless concurrently with other mutating operations on the same checkout.
- **Never commit, push, or create a PR** from headless mode. The caller owns those decisions.
- **End with "Review complete" as the terminal signal** so callers can detect completion. If all reviewers fail or time out, emit `Code review degraded (headless mode). Reason: 0 of N reviewers returned results.` followed by "Review complete".

### Interactive mode rules

- **Pre-load the platform question tool before any question fires.** In Claude Code, `AskUserQuestion` is a deferred tool — its schema is not available at session start. At the start of Interactive-mode work (before Stage 2 intent-ambiguity questions, the After-Review routing question, walk-through per-finding questions, bulk-preview Proceed/Cancel, and tracker-defer failure sub-questions), call `ToolSearch` with query `select:AskUserQuestion` to load the schema. Load it **once, eagerly, at the top of the Interactive flow** — do not wait for the first question site and do not decide it on a per-site basis. On Codex, Gemini, and Pi this preload step does not apply.
- **The numbered-list fallback only applies when the harness genuinely lacks a blocking question tool** — `ToolSearch` returns no match, the tool call explicitly fails, or the runtime mode does not expose it (e.g., Codex edit modes where `request_user_input` is unavailable). A pending schema load is not a fallback trigger; call `ToolSearch` first per the pre-load rule. Rendering a question as narrative text because the tool feels inconvenient, because the model is in report-formatting mode, or because the instruction was buried in a long skill is a bug. A question that calls for a user decision must either fire the tool or fall back loudly.

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

18 reviewer personas in layered conditionals, plus CE-specific agents. See the persona catalog included below for the full catalog.

**Always-on (every review):**

| Agent | Focus |
|-------|-------|
| `ce-correctness-reviewer` | Logic errors, edge cases, state bugs, error propagation |
| `ce-testing-reviewer` | Coverage gaps, weak assertions, brittle tests |
| `ce-maintainability-reviewer` | Coupling, complexity, naming, dead code, abstraction debt |
| `ce-project-standards-reviewer` | CLAUDE.md and AGENTS.md compliance -- frontmatter, references, naming, portability |
| `ce-agent-native-reviewer` | Verify new features are agent-accessible |
| `ce-learnings-researcher` | Search docs/solutions/ for past issues related to this PR |

**Cross-cutting conditional (selected per diff):**

| Agent | Select when diff touches... |
|-------|---------------------------|
| `ce-security-reviewer` | Auth, public endpoints, user input, permissions |
| `ce-performance-reviewer` | DB queries, data transforms, caching, async |
| `ce-api-contract-reviewer` | Routes, serializers, type signatures, versioning |
| `ce-data-migrations-reviewer` | Migrations, schema changes, backfills |
| `ce-reliability-reviewer` | Error handling, retries, timeouts, background jobs |
| `ce-adversarial-reviewer` | Diff >=50 changed non-test/non-generated/non-lockfile lines, or auth, payments, data mutations, external APIs |
| `ce-previous-comments-reviewer` | Reviewing a PR that has existing review comments or threads |

**Stack-specific conditional (selected per diff):**

| Agent | Select when diff touches... |
|-------|---------------------------|
| `ce-dhh-rails-reviewer` | Rails architecture, service objects, session/auth choices, or Hotwire-vs-SPA boundaries |
| `ce-kieran-rails-reviewer` | Rails application code where conventions, naming, and maintainability are in play |
| `ce-kieran-python-reviewer` | Python modules, endpoints, scripts, or services |
| `ce-kieran-typescript-reviewer` | TypeScript components, services, hooks, utilities, or shared types |
| `ce-julik-frontend-races-reviewer` | Stimulus/Turbo controllers, DOM events, timers, animations, or async UI flows |
| `ce-swift-ios-reviewer` | Swift files, SwiftUI views, UIKit controllers, entitlements, privacy manifests, Core Data models, SPM manifests, storyboards/XIBs, or semantic build-setting/target/signing changes in .pbxproj |

**CE conditional (migration-specific):**

| Agent | Select when diff includes migration files |
|-------|------------------------------------------|
| `ce-schema-drift-detector` | Cross-references schema.rb against included migrations |
| `ce-deployment-verification-agent` | Produces deployment checklist with SQL verification queries |

## Review Scope

Every review spawns all 4 always-on personas plus the 2 CE always-on agents, then adds whichever cross-cutting and stack-specific conditionals fit the diff. The model naturally right-sizes: a small config change triggers 0 conditionals = 6 reviewers. A Rails auth feature might trigger security + reliability + kieran-rails + dhh-rails = 10 reviewers.

## Protected Artifacts

The following paths are compound-engineering pipeline artifacts and must never be flagged for deletion, removal, or gitignore by any reviewer:

- `docs/brainstorms/*` -- requirements documents created by ce-brainstorm
- `docs/plans/*.md` -- plan files created by ce-plan (decision artifacts; execution progress is derived from git, not stored in plan bodies)
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

This path works with any ref — a SHA, `origin/main`, a branch name. Automated callers (ce-work, lfg, slfg) should prefer this to avoid the detection overhead. **Do not combine `base:` with a PR number or branch target.** If both are present, stop with an error: "Cannot use `base:` with a PR number or branch target — `base:` implies the current checkout is already the correct branch. Pass `base:` alone, or pass the target alone and let scope detection resolve the base." This avoids scope/intent mismatches where the diff base comes from one source but the code and metadata come from another.

**If a PR number or GitHub URL is provided as an argument:**

If `mode:report-only` or `mode:headless` is active, do **not** run `gh pr checkout <number-or-url>` on the shared checkout. For `mode:report-only`, tell the caller: "mode:report-only cannot switch the shared checkout to review a PR target. Run it from an isolated worktree/checkout for that PR, or run report-only with no target argument on the already checked out branch." For `mode:headless`, emit `Review failed (headless mode). Reason: cannot switch shared checkout. Re-invoke with base:<ref> to review the current checkout, or run from an isolated worktree.` Stop here unless the review is already running in an isolated checkout.

**Skip-condition pre-check.** Before checkout or scope detection, run a PR-state probe to decide whether the review should proceed:

```
gh pr view <number-or-url> --json state,title,body,files
```

Apply skip rules in order:

- `state` is `CLOSED` or `MERGED` -> stop with message `PR is closed/merged; not reviewing.`
- **Trivial-PR judgment**: spawn a lightweight sub-agent (use `model: haiku` in Claude Code; gpt-5.4-nano or equivalent in Codex) with the PR title, body, and changed file paths. The agent's task: "Is this an automated or trivial PR that does not warrant a code review? Consider: dependency lock-file or manifest-only bumps, automated release commits, chore version increments with no substantive code changes. When in doubt, answer no — false negatives (skipped reviews that should have run) are more costly than false positives (unnecessary reviews)." If the judgment returns yes: stop with message `PR appears to be a trivial automated PR; not reviewing. Run without a PR argument to review the current branch, or pass base:<ref> if review is intended.`

When any skip rule fires, emit the message and stop without dispatching reviewers, switching the checkout, or running scope detection. **Standalone branch mode and `base:` mode are unaffected** -- they always run the full review. **Draft PRs are reviewed normally** -- draft status is not a skip condition; early feedback on in-progress work is valuable.

If no skip rule fires, proceed to the checkout logic below.

First, verify the worktree is clean before switching branches:

```
git status --porcelain
```

If the output is non-empty, inform the user: "You have uncommitted changes on the current branch. Stash or commit them before reviewing a PR, or use standalone mode (no argument) to review the current branch as-is." Do not proceed with checkout until the worktree is clean.

Then check out the PR branch so persona agents can read the actual code (not the current checkout):

```
gh pr checkout <number-or-url>
```

Then fetch PR metadata. Capture the base branch name and the PR base repository identity, not just the branch name. Project `reviews` and `comments` to a `hasPriorComments` boolean via `--jq` -- counting only, not materializing review or comment bodies into the orchestrator's context. The reviews filter excludes approval-state submissions with empty bodies (approvals are not feedback to verify), so PRs with only approval clicks correctly fall through the gate. Stage 3 uses `hasPriorComments` to decide whether to spawn `previous-comments`:

```
gh pr view <number-or-url> --json title,body,baseRefName,headRefName,url,reviews,comments --jq '{title, body, baseRefName, headRefName, url, hasPriorComments: ((.reviews | map(select(.state != "APPROVED" or .body != "")) | length) > 0 or (.comments | length) > 0)}'
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

Then detect the review base branch and compute the merge-base. Run the `scripts/resolve-base.sh` script, which handles fork-safe remote resolution with multi-fallback detection (PR metadata -> `origin/HEAD` -> `gh repo view` -> common branch names):

```
RESOLVE_OUT=$(bash scripts/resolve-base.sh) || { echo "ERROR: resolve-base.sh failed"; exit 1; }
if [ -z "$RESOLVE_OUT" ] || echo "$RESOLVE_OUT" | grep -q '^ERROR:'; then echo "${RESOLVE_OUT:-ERROR: resolve-base.sh produced no output}"; exit 1; fi
BASE=$(echo "$RESOLVE_OUT" | sed 's/^BASE://')
```

If the script outputs an error, stop instead of falling back to `git diff HEAD`; a branch review without the base branch would only show uncommitted changes and silently miss all committed work.

On success, produce the diff:

```
echo "BASE:$BASE" && echo "FILES:" && git diff --name-only $BASE && echo "DIFF:" && git diff -U10 $BASE && echo "UNTRACKED:" && git ls-files --others --exclude-standard
```

You may still fetch additional PR metadata with `gh pr view` for title, body, linked issues, and a projected `hasPriorComments` boolean (use the same `--jq` shape from PR mode above so the gate ignores approval-only reviews and stays consistent across modes). Do not fail if no PR exists -- leave `hasPriorComments=false`.

**If no argument (standalone on current branch):**

Detect the review base branch and compute the merge-base using the same `scripts/resolve-base.sh` script as branch mode:

```
RESOLVE_OUT=$(bash scripts/resolve-base.sh) || { echo "ERROR: resolve-base.sh failed"; exit 1; }
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

- **Interactive mode:** Ask one question using the platform's blocking question tool (`AskUserQuestion` in Claude Code, `request_user_input` in Codex, `ask_user` in Gemini, `ask_user` in Pi (requires the `pi-ask-user` extension)): "What is the primary goal of these changes?" Do not spawn reviewers until intent is established. **Claude Code only:** if `AskUserQuestion` has not yet been loaded this session (per the Interactive mode rules pre-load), call `ToolSearch` with query `select:AskUserQuestion` first before asking. Fall back to numbered options in chat only when the harness genuinely lacks a blocking tool or the call errors (e.g., Codex edit modes) — not because a schema load is required. Never silently skip the question.
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

If a plan is found, read its **Requirements** section — `## Requirements` in current plans, `## Requirements Trace` in legacy ones — and the R-IDs (R1, R2, etc.) listed there, plus **Implementation Units** (current numeric subsections such as `### U1.`, `### U2.`, or `### Unit 1:` under `## Implementation Units`; legacy bullet or checkbox unit entries under that section also count). Store the extracted requirements list and `plan_source` for Stage 6. Do not block the review if no plan is found — requirements verification is additive, not required.

### Stage 3: Select reviewers

Read the diff and file list from Stage 1. The 4 always-on personas and 2 CE always-on agents are automatic. For each cross-cutting and stack-specific conditional persona in the persona catalog included below, decide whether the diff warrants it. This is agent judgment, not keyword matching.

**File-type awareness for conditional selection:** Instruction-prose files (Markdown skill definitions, JSON schemas, config files) are product code but do not benefit from runtime-focused reviewers. The adversarial reviewer's techniques (race conditions, cascade failures, abuse cases) target executable code behavior. For diffs that only change instruction-prose files, skip adversarial unless the prose describes auth, payment, or data-mutation behavior. Count only executable code lines toward line-count thresholds.

**`previous-comments` is PR-only AND comment-gated.** Only select this persona when both conditions hold:

1. Stage 1 gathered PR metadata (PR number or URL was provided as an argument, or `gh pr view` returned metadata for the current branch).
2. `hasPriorComments` from Stage 1 is true (the PR has at least one review submission or issue comment).

Skip it for standalone branch reviews with no associated PR, and skip it for PRs with no prior feedback yet -- there is nothing for the persona to verify, and a spawned subagent that returns empty findings still costs the full subagent startup overhead (persona spec, diff, schema, plus its own gh calls).

Stack-specific personas are additive. A Rails UI change may warrant `kieran-rails` plus `julik-frontend-races`; a TypeScript API diff may warrant `kieran-typescript` plus `api-contract` and `reliability`.

For CE conditional agents, check if the diff includes files matching `db/migrate/*.rb`, `db/schema.rb`, or data backfill scripts.

Announce the team before spawning:

```
Review team:
- correctness (always)
- testing (always)
- maintainability (always)
- project-standards (always)
- ce-agent-native-reviewer (always)
- ce-learnings-researcher (always)
- security -- new endpoint in routes.rb accepts user-provided redirect URL
- kieran-rails -- controller and Turbo flow changed in app/controllers and app/views
- dhh-rails -- diff adds service objects around ordinary Rails CRUD
- data-migrations -- adds migration 20260303_add_index_to_orders
- ce-schema-drift-detector -- migration files present
```

This is progress reporting, not a blocking confirmation.

### Stage 3b: Discover project standards paths

Before spawning sub-agents, find the file paths (not contents) of all relevant standards files for the `project-standards` persona. Use the native file-search/glob tool to locate:

1. Use the native file-search tool (e.g., Glob in Claude Code) to find all `**/CLAUDE.md` and `**/AGENTS.md` in the repo.
2. Filter to those whose directory is an ancestor of at least one changed file. A standards file governs all files below it (e.g., `plugins/compound-engineering/AGENTS.md` applies to everything under `plugins/compound-engineering/`).

Pass the resulting path list to the `project-standards` persona inside a `<standards-paths>` block in its review context (see Stage 4). The persona reads the files itself, targeting only the sections relevant to the changed file types. This keeps the orchestrator's work cheap (path discovery only) and avoids bloating the subagent prompt with content the reviewer may not fully need.

### Stage 4: Spawn sub-agents

#### Model tiering

Three reviewers inherit the session model with no override: `ce-correctness-reviewer`, `ce-security-reviewer`, and `ce-adversarial-reviewer`. These perform the highest-stakes analysis — logic bugs, security vulnerabilities, adversarial failure scenarios — and should run at whatever capability level the user has configured. If the user is on Opus, these get Opus.

All other persona sub-agents and CE agents use the platform's mid-tier model to reduce cost and latency. See the Spawning subsection below for the exact dispatch-time override — the imperative lives there so it lands at the point of action when spawning many agents in parallel.

The orchestrator (this skill) also inherits the session model; it handles intent discovery, reviewer selection, finding merge/dedup, and synthesis -- tasks that benefit from the same reasoning capability the user configured.

#### Run ID

Generate a unique run identifier before dispatching any agents. This ID scopes all agent artifact files and the post-review run artifact to the same directory.

```bash
RUN_ID=$(date +%Y%m%d-%H%M%S)-$(head -c4 /dev/urandom | od -An -tx1 | tr -d ' ')
mkdir -p "/tmp/compound-engineering/ce-code-review/$RUN_ID"
```

Pass `{run_id}` to every persona sub-agent so they can write their full analysis to `/tmp/compound-engineering/ce-code-review/{run_id}/{reviewer_name}.json`.

**Report-only mode:** Skip run-id generation and directory creation. Do not pass `{run_id}` to agents. Agents return compact JSON only with no file write, consistent with report-only's no-write contract.

#### Spawning

Omit the `mode` parameter when dispatching sub-agents so the user's configured permission settings apply. Do not pass `mode: "auto"`.

**Model override at dispatch time.** Pass the platform's mid-tier model on every dispatch except `ce-correctness-reviewer`, `ce-security-reviewer`, and `ce-adversarial-reviewer`, which inherit the session model (per the Model tiering subsection above). In Claude Code, add `model: "sonnet"` to the `Agent` tool call. In Codex, pass the equivalent mid-tier on `spawn_agent` (e.g., `gpt-5.4-mini` as of April 2026). In Pi, pass the equivalent on `subagent` via the `pi-subagents` extension. On platforms where the dispatch primitive has no model-override parameter or the available model names are unknown, omit the override — a working review on the parent model beats a broken dispatch on an unrecognized name. Check this on every Agent / `spawn_agent` / `subagent` call in the parallel dispatch; omitting it on Opus sessions silently 3-4x's the cost of a review.

**Bounded parallel dispatch.** Respect the current harness's active-subagent limit. Queue selected reviewers, dispatch only as many as the harness accepts, and fill freed slots as reviewers complete. Treat active-agent/thread/concurrency-limit spawn errors as backpressure, not reviewer failure: leave the reviewer queued and retry after a slot frees. Record a reviewer as failed only after a successful dispatch times out/fails, or when dispatch fails for a non-capacity reason.

Spawn each selected persona reviewer using the subagent template included below. Each persona sub-agent receives:

1. Their persona file content (identity, failure modes, calibration, suppress conditions)
2. Shared diff-scope rules from the diff-scope reference included below
3. The JSON output contract from the findings schema included below
4. PR metadata: title, body, and URL when reviewing a PR (empty string otherwise). Passed in a `<pr-context>` block so reviewers can verify code against stated intent
5. Review context: intent summary, file list, diff
6. Run ID and reviewer name for the artifact file path
7. **For `project-standards` only:** the standards file path list from Stage 3b, wrapped in a `<standards-paths>` block appended to the review context

Persona sub-agents are **read-only** with respect to the project: they review and return structured JSON. They do not edit project files or propose refactors. The one permitted write is saving their full analysis to the run-artifact path specified in the output contract (under `/tmp/compound-engineering/ce-code-review/<run-id>/`).

Read-only here means **non-mutating**, not "no shell access." Reviewer sub-agents may use non-mutating inspection commands when needed to gather evidence or verify scope, including read-oriented `git` / `gh` usage such as `git diff`, `git show`, `git blame`, `git log`, and `gh pr view`. They must not edit project files, change branches, commit, push, create PRs, or otherwise mutate the checkout or repository state.

Each persona sub-agent writes full JSON (all schema fields) to `/tmp/compound-engineering/ce-code-review/{run_id}/{reviewer_name}.json` and returns compact JSON with merge-tier fields only:

```json
{
  "reviewer": "security",
  "findings": [
    {
      "title": "User-supplied ID in account lookup without ownership check",
      "severity": "P0",
      "file": "orders_controller.rb",
      "line": 42,
      "confidence": 100,
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

**CE always-on agents** (ce-agent-native-reviewer, ce-learnings-researcher) are dispatched as standard Agent calls through the same bounded parallel scheduler as the persona agents. Give them the same review context bundle the personas receive: entry mode, any PR metadata gathered in Stage 1, intent summary, review base branch name when known, `BASE:` marker, file list, diff, and `UNTRACKED:` scope notes. Do not invoke them with a generic "review this" prompt. Their output is unstructured and synthesized separately in Stage 6.

**CE conditional agents** (ce-schema-drift-detector, ce-deployment-verification-agent) are also dispatched as standard Agent calls through the same bounded parallel scheduler when applicable. Pass the same review context bundle plus the applicability reason (for example, which migration files triggered the agent). For ce-schema-drift-detector specifically, pass the resolved review base branch explicitly so it never assumes `main`. Their output is unstructured and must be preserved for Stage 6 synthesis just like the CE always-on agents.

### Stage 5: Merge findings

Convert multiple reviewer compact JSON returns into one deduplicated, confidence-gated finding set. The compact returns contain merge-tier fields (title, severity, file, line, confidence, autofix_class, owner, requires_verification, pre_existing) plus the optional suggested_fix. Detail-tier fields (why_it_matters, evidence) are on disk in the per-agent artifact files and are not loaded at this stage.

`confidence` is one of 5 discrete anchors (`0`, `25`, `50`, `75`, `100`) with behavioral definitions in the findings schema. Synthesis treats anchors as integers; do not coerce to floats.

1. **Validate.** Check each compact return for required top-level and per-finding fields, plus value constraints. Drop malformed returns or findings. Record the drop count.
   - **Top-level required:** reviewer (string), findings (array), residual_risks (array), testing_gaps (array). Drop the entire return if any are missing or wrong type.
   - **Per-finding required:** title, severity, file, line, confidence, autofix_class, owner, requires_verification, pre_existing
   - **Value constraints:**
     - severity: P0 | P1 | P2 | P3
     - autofix_class: safe_auto | gated_auto | manual | advisory
     - owner: review-fixer | downstream-resolver | human | release
     - confidence: integer in {0, 25, 50, 75, 100}
     - line: positive integer
     - pre_existing, requires_verification: boolean
   - Do not validate against the full schema here -- the full schema (including why_it_matters and evidence) applies to the artifact files on disk, not the compact returns.
2. **Deduplicate.** Compute fingerprint: `normalize(file) + line_bucket(line, +/-3) + normalize(title)`. When fingerprints match, merge: keep highest severity, keep highest anchor, note which reviewers flagged it. Dedup runs over the full validated set (including anchor 50) so cross-reviewer promotion in step 3 can lift matching anchor-50 findings into the actionable tier.
3. **Cross-reviewer agreement.** When 2+ independent reviewers flag the same issue (same fingerprint), promote the merged finding by one anchor step: `50 -> 75`, `75 -> 100`, `100 -> 100`. Cross-reviewer corroboration is a stronger signal than any single reviewer's anchor; the promotion routes a previously-soft finding into the actionable tier or strengthens its already-actionable position. Note the agreement in the Reviewer column of the output (e.g., "security, correctness").
4. **Separate pre-existing.** Pull out findings with `pre_existing: true` into a separate list.
5. **Resolve disagreements.** When reviewers flag the same code region but disagree on severity, autofix_class, or owner, annotate the Reviewer column with the disagreement (e.g., "security (P0), correctness (P1) -- kept P0"). This transparency helps the user understand why a finding was routed the way it was.
6. **Normalize routing.** For each merged finding, set the final `autofix_class`, `owner`, and `requires_verification`. If reviewers disagree, keep the most conservative route. Synthesis may narrow a finding from `safe_auto` to `gated_auto` or `manual`, but must not widen it without new evidence.
6b. **Derive the recommended action.** Interactive mode's walk-through and best-judgment paths present a per-finding recommended action (Apply / Defer / Skip / Acknowledge). The recommendation is derived from the normalized `autofix_class` and the presence of `suggested_fix` using this mapping:

| `autofix_class` | `suggested_fix` present? | Recommended action |
|-----------------|--------------------------|--------------------|
| `safe_auto`     | (auto-applied before the routing question; not surfaced to best-judgment/walk-through) | Apply |
| `gated_auto`    | yes                      | Apply |
| `gated_auto`    | no                       | Defer |
| `manual`        | **yes**                  | **Apply** |
| `manual`        | no                       | Defer |
| `advisory`      | n/a                      | Acknowledge |

The presence of `suggested_fix` is the authoritative signal that the agent can act on the finding. A `manual` finding *with* a `suggested_fix` recommends Apply because the persona has committed to a concrete fix shape grounded in review context (per the subagent template's suggested_fix rule). A `manual` finding *without* a `suggested_fix` recommends Defer because the persona signaled that the fix genuinely needs cross-team input or business-rule context the reviewer cannot provide. `autofix_class` itself is not collapsed by this mapping — the report still records what the persona thought (`manual` vs `gated_auto`), and the distinction matters for downstream surfaces like the unified completion report.

**Cross-reviewer tie-break.** When contributing reviewers implied different actions for the same merged finding, synthesis picks the most conservative using the order `Skip > Defer > Apply > Acknowledge`. This rule fires only on multi-reviewer disagreement; the per-finding mapping above is the single-reviewer default. Tie-break guarantees that identical review artifacts produce the same recommendation deterministically, so best-judgment results are auditable after the fact and the walk-through's recommendation is stable across re-runs. The user may still override per finding via the walk-through's options; this rule only determines what gets labeled "recommended."
6c. **Mode-aware demotion of weak general-quality findings.** Some persona output is real signal but does not warrant primary-findings attention. Reroute it to the existing soft buckets so the primary findings table stays focused on actionable issues.

A finding qualifies for demotion when **all** of these hold:
   - Severity is P2 or P3 (P0 and P1 always stay in primary findings)
   - `autofix_class` is `advisory` (concrete-fix findings stay in primary)
   - **All** contributing reviewers are `testing` or `maintainability` — if any other persona also flagged this finding, cross-reviewer corroboration is present and the finding stays in primary findings regardless of its severity or advisory status (expand the weak-signal list later only with evidence)

When a finding qualifies, route by mode:
   - **Interactive and report-only modes:** Move the finding out of the primary findings set. If the contributing reviewer is `testing`, append `<file:line> -- <title>` to `testing_gaps`. If `maintainability`, append the same to `residual_risks`. Record the demotion count for Coverage. The finding does not appear in the Stage 6 findings table. (Use title only -- the compact return omits `why_it_matters`, and report-only mode skips artifact files entirely. Soft-bucket entries are FYI items; readers who want depth can open the per-agent artifact when one exists.)
   - **Headless and autofix modes:** Suppress the finding entirely. Record the suppressed count in Coverage as "mode-aware demotion suppressions" so the user can see what was filtered.

Demotion is intentionally narrow. The conservative scope (testing/maintainability + P2/P3 + advisory) is the starting point; do not expand the rule by guessing which other personas overproduce noise. If real review runs show another persona consistently emitting weak signal, expand with evidence.

7. **Confidence gate.** After dedup, promotion, and demotion have shaped the primary set, suppress remaining findings below anchor 75. Exception: P0 findings at anchor 50+ survive the gate -- critical-but-uncertain issues must not be silently dropped. Record the suppressed count by anchor (so Coverage can report "N findings suppressed at anchor 50, M at anchor 25"). The gate runs late deliberately: anchor-50 findings need a chance to be promoted by step 3 (cross-reviewer corroboration) or rerouted by step 6c (mode-aware demotion to soft buckets) before any drop decision.
8. **Partition the work.** Build three sets:
   - in-skill fixer queue: only `safe_auto -> review-fixer`
   - residual actionable queue: unresolved `gated_auto` or `manual` findings whose owner is `downstream-resolver`
   - report-only queue: `advisory` findings plus anything owned by `human` or `release`
9. **Sort and number.** Order by severity (P0 first) -> anchor (descending) -> file path -> line number, then assign monotonically increasing `#` values across the full primary finding set in that sorted order. Do not restart numbering inside each severity table or autofix/routing bucket. If later sections repeat a finding (for example Residual Actionable Work after `safe_auto` fixes are applied), reuse the same stable `#` so users -- and downstream skills like `ce-resolve-pr-feedback` -- can reference findings by `#` after the autofix loop rewrites the report. Renumbering after autofix invalidates any prior reference: copied snippets, follow-up prompts citing `#3`, or tickets filed against an earlier render.
10. **Collect coverage data.** Union residual_risks and testing_gaps across reviewers.
11. **Preserve CE agent artifacts.** Keep the learnings, agent-native, schema-drift, and deployment-verification outputs alongside the merged finding set. Do not drop unstructured agent output just because it does not match the persona JSON schema.

### Stage 5b: Validation pass (externalizing modes only)

Independent verification gate. Spawn one validator sub-agent per surviving finding using `references/validator-template.md`. The validator's job is to re-check the finding against the diff and surrounding code with no commitment to the original persona's analysis. Findings the validator rejects are dropped; findings the validator confirms flow through unchanged.

**When this stage runs:**

| Mode | Runs Stage 5b? | Where |
|------|---------------|-------|
| `headless` | Yes, eagerly | Between Stage 5 and Stage 6 |
| `autofix` | Yes, eagerly | Between Stage 5 and Stage 6 |
| `interactive`, walk-through routing (option A) — per-finding phase | No -- the user is the per-finding validator | n/a |
| `interactive`, walk-through routing (option A) — best-judgment-the-rest handoff | No -- the best-judgment path dispatches the fixer immediately; the fixer's apply/fail outcome is the validation | n/a |
| `interactive`, best-judgment routing (option B) | No -- the best-judgment path dispatches the fixer immediately; the fixer's apply/fail outcome is the validation | n/a |
| `interactive`, File-tickets routing (option C) | Yes, on all pending findings | Before tracker dispatch |
| `interactive`, Report-only routing (option D) | No -- nothing is being externalized | n/a |
| `report-only` | No -- read-only mode externalizes nothing | n/a |

The best-judgment path skips Stage 5b deliberately. Running per-finding validators before the fixer dispatches is duplicate research — the fixer naturally re-checks each finding when applying or proposing the fix, and items where the cited evidence no longer matches the code (the false-positive case Stage 5b would catch) are routed to the `failed` bucket during the fix attempt itself. The user reviews via diff and the post-run failure-handling question (see Step 2 Interactive option B), not via a pre-dispatch validator gate.

When Stage 5b does not run, the merged finding set from Stage 5 flows through to Stage 6 unchanged. When it runs, the steps below execute on the relevant set.

**Steps:**

1. **Select findings to validate.**
   - **headless/autofix:** All survivors of Stage 5.
   - **interactive File-tickets (option C):** All pending findings regardless of recommended action. Option C externalizes every finding as a ticket, so every finding needs validation.
2. **Apply dispatch budget cap.** If the selected set exceeds 15 findings, validate the highest-severity 15 (P0 first, then P1, then P2, then P3, breaking ties by anchor descending). Drop the remainder and record the over-budget count for the Coverage section. The blunt drop is intentional; a review producing 15+ surviving findings is already in territory where a second wave would not change the user's triage approach.
3. **Spawn validators with bounded parallelism.** One sub-agent per finding, dispatched independently using the validator template and the same bounded scheduler from Stage 4. Each validator receives:
   - The finding's title, severity, file, line, suggested_fix, original reviewer name, and confidence anchor
   - `why_it_matters` when available — loaded from the per-agent artifact file at `/tmp/compound-engineering/ce-code-review/{run_id}/{reviewer_name}.json`; omit when the file is absent or the artifact write failed. The validator proceeds without it, using the diff and cited code directly.
   - The full diff
   - Read-tool access to inspect the cited code, callers, guards, framework defaults, and git blame
4. **Collect verdicts.** Each validator returns `{ "validated": true | false, "reason": "<one sentence>" }`.
   - `validated: true` -> finding survives unchanged into the next phase (Stage 6 for headless/autofix, dispatch for interactive)
   - `validated: false` -> finding is dropped; record the validator's reason in Coverage
   - Validator failure (timeout, dispatch error, malformed JSON) -> drop the finding with reason "validator failed"; conservative bias is correct
5. **Use mid-tier model for validators.** Same model class (sonnet) the persona reviewers use. Validators are read-only — same constraints as persona reviewers. They may use non-mutating inspection commands (Read, Grep, Glob, git blame, gh).
6. **Record metrics for Coverage.** Total dispatched, validated true count, validated false count (with reasons), failures, and over-budget drops.

**Why per-finding bounded dispatch (not batched):** Independence is the point. A single batched validator looking at all findings together pattern-matches across them and recreates the persona-bias problem. Per-finding dispatch preserves fresh context while the scheduler respects harness limits. Per-file batching is a plausible future optimization for reviews with many findings clustered in few files; not implemented today.

### Stage 6: Synthesize and present

Assemble the final report using **pipe-delimited markdown tables for findings** from the review output template included below. The table format is mandatory for finding rows in interactive mode — do not render findings as freeform text blocks or horizontal-rule-separated prose. Other report sections (Applied Fixes, Learnings, Coverage, etc.) use bullet lists and the `---` separator before the verdict, as shown in the template.

1. **Header.** Scope, intent, mode, reviewer team with per-conditional justifications.
2. **Findings.** Rendered as pipe-delimited tables grouped by severity (`### P0 -- Critical`, `### P1 -- High`, `### P2 -- Moderate`, `### P3 -- Low`). Each finding row shows `#`, file, issue, reviewer(s), confidence, and synthesized route. Omit empty severity levels. Never render findings as freeform text blocks or numbered lists. Finding numbers come from the stable assignment in Stage 5 -- never re-derive them per severity table.
3. **Requirements Completeness.** Include only when a plan was found in Stage 2b. For each requirement (R1, R2, etc.) and implementation unit in the plan, report whether corresponding work appears in the diff. Use a simple checklist: met / not addressed / partially addressed. Routing depends on `plan_source`:
   - **`explicit`** (caller-provided or PR body): Flag unaddressed requirements or implementation units as P1 findings with `autofix_class: manual`, `owner: downstream-resolver`. These enter the residual actionable queue.
   - **`inferred`** (auto-discovered): Flag unaddressed requirements or implementation units as P3 findings with `autofix_class: advisory`, `owner: human`. These stay in the report only — no autonomous follow-up. An inferred plan match is a hint, not a contract.
   Omit this section entirely when no plan was found — do not mention the absence of a plan.
4. **Applied Fixes.** Include only if a fix phase ran in this invocation.
5. **Residual Actionable Work.** Include when unresolved actionable findings were handed off or should be handed off.
6. **Pre-existing.** Separate section, does not count toward verdict.
7. **Learnings & Past Solutions.** Surface ce-learnings-researcher results: if past solutions are relevant, flag them as "Known Pattern" with links to docs/solutions/ files.
8. **Agent-Native Gaps.** Surface ce-agent-native-reviewer results. Omit section if no gaps found.
9. **Schema Drift Check.** If ce-schema-drift-detector ran, summarize whether drift was found. If drift exists, list the unrelated schema objects and the required cleanup command. If clean, say so briefly.
10. **Deployment Notes.** If ce-deployment-verification-agent ran, surface the key Go/No-Go items: blocking pre-deploy checks, the most important verification queries, rollback caveats, and monitoring focus areas. Keep the checklist actionable rather than dropping it into Coverage.
11. **Coverage.** Suppressed count by anchor (e.g., "N findings suppressed at anchor 50, M at anchor 25"), mode-aware demotion count (interactive/report-only) or suppression count (headless/autofix), validator drop count and reasons (when Stage 5b ran), validator over-budget drops (when the 15-cap fired), residual risks, testing gaps, failed/timed-out reviewers, and any intent uncertainty carried by non-interactive modes.
12. **Verdict.** Ready to merge / Ready with fixes / Not ready. Fix order if applicable. When an `explicit` plan has unaddressed requirements or implementation units, the verdict must reflect it — a PR that's code-clean but missing planned requirements is "Not ready" unless the omission is intentional. When an `inferred` plan has unaddressed requirements or implementation units, note it in the verdict reasoning but do not block on it alone.

Do not include time estimates.

**Format verification:** Before delivering the report, verify the findings sections use pipe-delimited table rows (`| # | File | Issue | ... |`) not freeform text. If you catch yourself rendering findings as prose blocks separated by horizontal rules or bullet points, stop and reformat into tables.

### Headless output format

In `mode:headless`, replace the interactive pipe-delimited table report with a structured text envelope. The envelope follows the same structural pattern as document-review's headless output (completion header, metadata block, findings grouped by autofix_class, trailing sections) while using ce-code-review's own section headings and per-finding fields.

```
Code review complete (headless mode).

Scope: <scope-line>
Intent: <intent-summary>
Reviewers: <reviewer-list with conditional justifications>
Verdict: <Ready to merge | Ready with fixes | Not ready>
Artifact: /tmp/compound-engineering/ce-code-review/<run-id>/

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
- Suppressed: <N> findings below anchor 75 (P0 at anchor 50+ retained)
- Mode-aware demotion suppressions: <N> findings suppressed (testing/maintainability advisory P2-P3)
- Validator drops: <N> findings rejected by Stage 5b validator
  - <file:line> -- <reason>
- Validator over-budget drops: <N> findings exceeded the 15-cap and were not validated
- Untracked files excluded: <file1>, <file2>
- Failed reviewers: <reviewer>

Review complete
```

**Detail enrichment (headless only):** The headless envelope includes `Why:`, `Evidence:`, and `Suggested fix:` lines. After merge (Stage 5), read the per-agent artifact files from `/tmp/compound-engineering/ce-code-review/{run_id}/` for only the findings that survived dedup and confidence gating.
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
- **Never convert advisory-only outputs into fix work or ticket handoff.** Deployment notes, residual risks, and release-owned items stay in the report.

#### Step 2: Choose policy by mode

**Interactive mode**

- Apply `safe_auto -> review-fixer` findings automatically without asking. These are safe by definition.
- **Zero-remaining case:** if no `gated_auto` or `manual` findings remain after the `safe_auto` pass, skip the routing question entirely. Emit a one-line completion summary phrased so advisory and pre-existing findings (which are not handled by this flow) are not implied to be cleared. When no advisory or pre-existing findings remain in the report, `All findings resolved — N safe_auto fixes applied.` is accurate. When advisory and/or pre-existing findings do remain, use the qualified form `All actionable findings resolved — N safe_auto fixes applied. (K advisory, J pre-existing findings remain in the report.)`, omitting any zero-count clause. Follow the summary with the existing end-of-review verdict, then proceed to Step 5 per the gating rule there.
- **Tracker pre-detection:** before rendering the routing question, consult `references/tracker-defer.md` for the session's tracker tuple `{ tracker_name, confidence, named_sink_available, any_sink_available }`. The probe runs at most once per session and is cached for the rest of the run. `named_sink_available` drives the option C label (inline tracker name only when the named sink can actually be invoked). `any_sink_available` drives whether option C is offered at all (it can still be offered when the named tracker is unreachable but GitHub Issues via `gh` works).
- **Verify question-tool pre-load (checklist, Claude Code only).** Before firing the routing question in Claude Code, confirm `AskUserQuestion` is loaded (per Interactive mode rules at the top of this skill). If not yet loaded this session, call `ToolSearch` with query `select:AskUserQuestion` now. Do not proceed to the routing question without this verification. Rendering the question as narrative text because the schema isn't loaded yet is a bug, not a valid fallback. On Codex, Gemini, and Pi this checklist does not apply — there is no `ToolSearch` preload step to perform. (If `request_user_input` is unavailable in the current Codex runtime mode, use the numbered-list fallback described below.)
- **Routing question.** Ask using the platform's blocking question tool (`AskUserQuestion` in Claude Code, `request_user_input` in Codex, `ask_user` in Gemini, `ask_user` in Pi (requires the `pi-ask-user` extension)). Stem: `What should the agent do with the remaining N findings?` — use third-person voice referring to "the agent", not first-person "me" / "I". Options:

  ```
  (A) Review each finding one by one — accept the recommendation or choose another action
  (B) Auto-resolve with best judgment — apply per-finding fixes the agent can defend, surface the rest
  (C) File a [TRACKER] ticket per finding without applying fixes
  (D) Report only — take no further action
  ```

  Render option C per `references/tracker-defer.md`: when `confidence = high` AND `named_sink_available = true`, replace `[TRACKER]` with the concrete name and keep the full label (e.g., `File a Linear ticket per finding without applying fixes`). When `any_sink_available = true` but either `confidence = low` or `named_sink_available = false` (GitHub Issues via `gh` is working as the fallback), use the generic label `File an issue per finding without applying fixes` — this is a whole-label substitution, not a `[TRACKER]` token swap. When `any_sink_available = false`, **omit option C entirely** and add one line to the stem explaining that no issue tracker is configured for this checkout (Linear, GitHub Issues, etc., were probed and unavailable). Phrase it for a developer audience — avoid `tracker sink` jargon, and avoid `platform` since the missing piece is per-project, not per-agent-platform. The three remaining options (A, B, D) survive.

  The numbered-list text fallback applies when `ToolSearch` explicitly returns no match for the platform's question tool or the tool call errors (including Codex runtime modes where `request_user_input` is unavailable). It does not apply when the agent simply hasn't loaded the tool yet — in that case, load it now (see the verification checklist above). When the fallback applies, present the options as a numbered list and wait for the user's reply — never silently skip the question.

- **Dispatch on selection.** Route by the option letter (A / B / C / D), not by the rendered label string. The option-C label varies by tracker-detection confidence (`File a [TRACKER] ticket per finding without applying fixes` for a named tracker, `File an issue per finding without applying fixes` as the generic fallback, or omitted entirely when no sink is available — see `references/tracker-defer.md`), and options A / B / D have a single canonical label each. The letter is the stable dispatch signal; the canonical labels below are shown for documentation only. A low-confidence run that rendered option C as the generic label routes to the same branch as a high-confidence run that rendered it with the named tracker.
  - (A) `Review each finding one by one` — **before presenting the first finding, read `references/walkthrough.md` in full.** It is the canonical spec for the per-finding presentation format and the option menu. Do not improvise from memory; do not paraphrase the format; do not invent custom option variants. Then enter the per-finding walk-through loop. Decision handling:
    - When the user picks `Apply`, queue the fix for end-of-loop dispatch — do not apply it immediately.
    - When the user picks `Defer`, file the ticket inline via `references/tracker-defer.md`.
    - When the user picks `Skip` or `Acknowledge`, record the decision as no-action.
    - When the user picks the option to auto-resolve the rest, exit the loop and dispatch **one** fixer pass on the union of (queued Apply set ∪ remaining undecided findings) — there is no second end-of-loop dispatch in this branch, so the "one fixer, consistent tree" contract holds.

    When the user works through every finding without invoking the auto-resolve-the-rest option, dispatch one fixer subagent for the queued Apply set at end of loop (Step 3). Emit the unified completion report after dispatch.
  - (B) `Auto-resolve with best judgment — apply per-finding fixes the agent can defend, surface the rest` — dispatch the fixer subagent (Step 3) immediately on the full pending action set (`gated_auto` + `manual` + `advisory`). No Stage 5b validator pre-pass. No bulk-preview approval gate. The fixer applies items with concrete `suggested_fix`, no-ops on advisory items, and routes items where the fix cannot be applied cleanly (or where the cited evidence no longer matches the code) to a `failed` bucket with a one-line reason.

    **After the fixer returns, the order is:**
    1. **If `failed` is empty:** emit the unified completion report and proceed to Step 5 per its gating rule. No question fires.
    2. **If `failed` is non-empty:** fire the post-run failure-handling question *first* — emitting the report before the user resolves the failed bucket would produce a stale or duplicated report, since `File tickets` and `Walk through` both change the final action state. Stem: `N findings could not be auto-resolved. What should the agent do with them?` Three options:
       - `File tickets for these` — route the failed set through `references/tracker-defer.md` Interactive mode. Omit this option when the cached tracker-detection tuple reports `any_sink_available = false`, and append one line to the stem explaining that no issue tracker is configured for this checkout (Linear, GitHub Issues, etc., were probed and unavailable). Phrase it for a developer audience — avoid `tracker sink` jargon, and avoid `platform` since the missing piece is per-project, not per-agent-platform.
       - `Walk through these one at a time` — re-enter the walk-through loop scoped to the failed set. Each finding's recommended action is recomputed via the Stage 5 step 6b mapping: items that have a `suggested_fix` recommend Apply (and join the in-memory Apply set if the user picks Apply, dispatching at end-of-walk-through to a focused fixer pass on those items only); items without a `suggested_fix` recommend Defer (Apply is not offered for them; menu is Defer / Skip / `Auto-resolve with best judgment on the rest`).
       - `Ignore — leave them in the report` — record the failed list as residual actionable work in the report. No further action.

       After the user's choice executes (tickets filed, walk-through completed, or ignore recorded), emit the unified completion report. The report reflects the final state including any tickets filed or additional fixes applied during walk-through re-entry.

    Numbered-list fallback applies when `ToolSearch` explicitly returns no match or the tool call errors (Codex edit modes without `request_user_input`) — never silently skip the question.

  - (C) `File a [TRACKER] ticket per finding without applying fixes` (or the generic `File an issue per finding without applying fixes` when the named-tracker label is not used) — first run Stage 5b validation on every pending finding. Drop validator-rejected findings with their reasons recorded in Coverage. Then load `references/bulk-preview.md` with every surviving finding in the file-tickets bucket. On `Proceed`, route every finding through `references/tracker-defer.md`; no fixes are applied. On `Cancel`, return to this routing question. Emit the unified completion report.
  - (D) `Report only — take no further action` — do not enter any dispatch phase. Emit the completion report, then proceed to Step 5 per its gating rule (`fixes_applied_count > 0` from earlier `safe_auto` passes). If no fixes were applied this run, stop after the report.

- The walk-through's completion report, the best-judgment / File-tickets completion report, and the zero-remaining completion summary all follow the unified completion-report structure documented in `references/walkthrough.md`. Use the same structure across every terminal path.

**Autofix mode**

- Ask no questions.
- Apply only the `safe_auto -> review-fixer` queue.
- Leave `gated_auto`, `manual`, `human`, and `release` items unresolved.
- Prepare residual work only for unresolved actionable findings whose final owner is `downstream-resolver`.

**Report-only mode**

- Ask no questions.
- Do not build a fixer queue.
- Do not write run artifacts.
- Stop after Stage 6. Everything remains in the report.

**Headless mode**

- Ask no questions.
- Apply only the `safe_auto -> review-fixer` queue in a single pass. Do not enter the bounded re-review loop (Step 3). Spawn one fixer subagent, apply fixes, then proceed directly to Step 4.
- Leave `gated_auto`, `manual`, `human`, and `release` items unresolved — they appear in the structured text output.
- Output the headless output envelope (see Stage 6) instead of the interactive report.
- Write a run artifact (Step 4). Do not file tickets or externalize work — the caller owns that.
- Stop after the structured text output and "Review complete" signal. No commit/push/PR.

#### Step 3: Apply fixes with one fixer

- Spawn exactly one fixer subagent for the current fixer queue in the current checkout. That fixer applies all approved changes and runs the relevant targeted tests in one pass against a consistent tree.
- Do not fan out multiple fixers against the same checkout. Parallel fixers require isolated worktrees/branches and deliberate mergeback.
- Do not start a mutating review round concurrently with browser testing on the same checkout. Future orchestrators that want both must either run `mode:report-only` during the parallel phase or isolate the mutating review in its own checkout/worktree.

**Queue contract by caller path:**

The fixer accepts two queue shapes depending on which caller invoked it:

- **Homogeneous queue (autofix, headless, walk-through Apply set):** every item is `safe_auto -> review-fixer` (autofix, headless), or every item carries a concrete `suggested_fix` (walk-through Apply set, where the user picked Apply on each finding). The fixer applies each item. **Defensive backstop for the walk-through Apply set:** the walk-through suppresses the Apply option for findings without a `suggested_fix` (see `references/walkthrough.md` adaptations) and the post-run failure-handling re-entry suppresses it as well, so this queue should not contain such items in normal runs. If one slips through, route it to `failed` with reason `no fix proposed by reviewer` rather than attempting an undefined apply — mirroring the heterogeneous queue's handling. Autofix and headless callers are unaffected; they only ever process `safe_auto` items.
- **Heterogeneous queue (best-judgment path — interactive option B and walk-through's `Auto-resolve with best judgment on the rest`):** the queue mixes `gated_auto`, `manual`, and `advisory` findings. Each item carries: `autofix_class`, `severity`, `file:line`, `title`, `suggested_fix` (may be null), `why_it_matters`, and `evidence`. The fixer routes each item to one of four buckets — the routing categories are fixed; the failure *reason string* should be specific enough that the post-run question's framing (`N findings could not be auto-resolved...`) reads meaningfully to the user. Use the category's default phrasing below when nothing more specific applies; prefer richer, finding-specific reasons that capture *why this particular item didn't land* (e.g., `needs intent confirmation; was the field narrowing deliberate, or do clients still need the full payload?` is more useful than the generic default).
  - **`safe_auto` / `gated_auto` / `manual` with `suggested_fix`:** light evidence-match check (verify the cited code at `file:line` still resembles the persona's evidence — concretely: at least one identifier or distinctive token from the evidence appears at the cited location, and the line has not been deleted). If the check passes, attempt to apply the fix. On clean apply, route to `applied`. On fix-application failure (line moved, conflicting edit, syntax issue), route to `failed` with a concrete reason — default phrasing `fix did not apply cleanly: <error>` when no richer description fits.
  - **`gated_auto` or `manual` without `suggested_fix`:** route to `failed` — default phrasing `no fix proposed by reviewer` when no richer description fits. For `manual` this signal indicates the persona judged the finding to need cross-team input or context outside the review; a richer reason naming the specific decision (intent ambiguity, contract decision, design choice) is more useful when the persona's `why_it_matters` or `evidence` makes that clear. For `gated_auto` this is a defensive case (the persona shouldn't normally produce `gated_auto` without a concrete fix) — surface it in `failed` rather than skipping it, to preserve the apply-or-fail contract.
  - **Advisory items (`autofix_class: advisory`):** no-op. Route to `advisory` (recorded as acknowledged).
  - **Evidence-match check fails:** route to `failed` — default phrasing `evidence no longer matches code at <file:line>` when no richer description fits. This is the false-positive case — the finding cited something that has since changed or was already handled.

**Best-judgment path is single-pass.** No `max_rounds: 2` re-review loop. After the fixer returns, the orchestrator follows Step 2 Interactive option B's post-fixer ordering: when the `failed` bucket is empty, emit the unified completion report directly; when it is non-empty, fire the post-run failure-handling question first, execute the user's choice, then emit the unified completion report so it reflects the final action state.

**Other paths retain the bounded-rounds loop.** For autofix and the walk-through Apply set, re-review only the changed scope after fixes land, bound the loop with `max_rounds: 2`, and if issues remain after the second round, hand them off as residual work or report them as unresolved.

**Verification.** If any applied finding has `requires_verification: true`, the fixer runs the targeted verification (focused tests or operational checks) for that item before declaring it `applied`. Verification failure routes the item to `failed` — default phrasing `verification failed: <test-name>` when no richer description fits (e.g., `verification failed: payment_spec timed out after 30s` is more useful than the bare default). This applies on every path.

**Fixer return shape (best-judgment path).** The fixer returns the partition `{applied, failed, advisory}` where each entry includes the finding identifier, original `autofix_class`, `severity`, `file:line`, and (for `failed`) a one-line reason. The orchestrator uses this partition to assemble the unified completion report and gate the post-run failure-handling question.

#### Step 4: Emit artifacts and downstream handoff

- In interactive, autofix, and headless modes, write a per-run artifact under `/tmp/compound-engineering/ce-code-review/<run-id>/` containing:
  - synthesized findings (merged output from Stage 5)
  - applied fixes
  - residual actionable work
  - advisory-only outputs
  Per-agent full-detail JSON files (`{reviewer_name}.json`) are already present in this directory from Stage 4 dispatch.
- Also write `metadata.json` alongside the findings so downstream skills (e.g., `ce-polish-beta`) can verify the artifact matches the current branch and HEAD. Minimum fields:
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
- In autofix mode, the run artifact is the handoff. Orchestrators read the artifact's residual actionable work and route it as appropriate. The skill itself does not file tickets or prompt the user in autofix.
- Interactive mode may offer to externalize residual actionable work via `references/tracker-defer.md` (named tracker -> GitHub Issues via `gh`), but it is not required to finish the review.

#### Step 5: Final next steps

**Interactive mode only.** After the fix-review cycle completes (clean verdict or the user chose to stop), offer next steps based on the entry mode. Reuse the resolved review base/default branch from Stage 1 when known; do not hard-code only `main`/`master`.

**The gate is total fixes applied this run, not routing option.** Track `fixes_applied_count` across the whole Interactive invocation. This counter includes both the `safe_auto` fixes applied automatically before the routing question (see Step 2 Interactive mode) AND any Apply decisions executed by routing option A (walk-through) or option B (best-judgment). Routing options C (File tickets) and D (Report only) add zero to this counter; neither does a walk-through that ends with only Skip / Defer / Acknowledge, and neither does a best-judgment dispatch whose findings were all routed to `failed` or `advisory`.

Step 5 runs only when `fixes_applied_count > 0`. If the counter is zero — no `safe_auto` fixes were applied AND the routing path produced no additional Apply — skip Step 5 entirely and exit after the completion report. Asking "push fixes?" when nothing changed in the working tree is incoherent.

Common outcomes:

- `safe_auto` produced fixes AND the user picked any routing option → Step 5 runs (counter > 0 from the safe_auto pass alone).
- No `safe_auto` fixes AND the user picked option C or D → Step 5 skipped.
- No `safe_auto` fixes AND walk-through / best-judgment finished with zero Applies → Step 5 skipped.
- Zero-remaining case (no `gated_auto` / `manual` after `safe_auto`) with at least one `safe_auto` fix → Step 5 runs; the routing question was never asked but the counter is > 0.

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

If the platform doesn't support parallel sub-agents, run reviewers sequentially. If the platform supports sub-agents but caps active concurrency, use the bounded queueing rules in Stage 4 rather than treating cap-related spawn failures as reviewer failures. Everything else (stages, output format, merge pipeline) stays the same.

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
