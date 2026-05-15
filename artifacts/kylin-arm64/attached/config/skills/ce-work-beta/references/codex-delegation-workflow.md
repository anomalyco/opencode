# Codex Delegation Workflow

When `delegation_active` is true, code implementation is delegated to the Codex CLI (`codex exec`) instead of being implemented directly. The orchestrating Claude Code agent retains control of planning, review, git operations, and orchestration.

## Delegation Decision

If `work_delegate_decision` is `ask`, present the recommendation and wait for the user's choice before proceeding.

**When recommending Codex delegation:**

> "Codex delegation active. [N] implementation units -- delegating in one batch."
> 1. Delegate to Codex *(recommended)*
> 2. Execute with Claude Code instead

**When recommending Codex delegation, multiple batches:**

> "Codex delegation active. [N] implementation units -- delegating in [X] batches."
> 1. Delegate to Codex *(recommended)*
> 2. Execute with Claude Code instead

**When recommending Claude Code (all units are trivial):**

> "Codex delegation active, but these are small changes where the cost of delegating outweighs having Claude Code do them."
> 1. Execute with Claude Code *(recommended)*
> 2. Delegate to Codex anyway

If the user chooses the delegation option, proceed to Pre-Delegation Checks below. If the user chooses the Claude Code option, set `delegation_active` to false and return to standard execution in the parent skill.

If `work_delegate_decision` is `auto` (the default), state the execution plan in one line and proceed without waiting: "Codex delegation active. Delegating [N] units in [X] batch(es)." If all units are trivial, set `delegation_active` to false and proceed: "Codex delegation active. All units are trivial -- executing with Claude Code."

## Pre-Delegation Checks

Run these checks **once before the first batch**. If any check fails, fall back to standard mode for the remainder of the plan execution. Do not re-run on subsequent batches.

**0. Platform Gate**

Codex delegation is only supported when the orchestrating agent is running in Claude Code. If the current session is Codex, Gemini CLI, OpenCode, or any other platform, set `delegation_active` to false and proceed in standard mode.

**1. Environment Guard**

Check whether the current agent is already running inside a Codex sandbox:

```bash
if [ -n "$CODEX_SANDBOX" ] || [ -n "$CODEX_SESSION_ID" ]; then
  echo "inside_sandbox=true"
else
  echo "inside_sandbox=false"
fi
```

If `inside_sandbox` is true, delegation would recurse or fail.

- If `delegation_source` is `argument`: emit "Already inside Codex sandbox -- using standard mode." and set `delegation_active` to false.
- If `delegation_source` is `config` or `default`: set `delegation_active` to false silently.

**2. Availability Check**

**Codex CLI path (pre-resolved):**
!`command -v codex 2>/dev/null || true`

If the line above shows an absolute path (starts with `/`, e.g., `/opt/homebrew/bin/codex`), the Codex CLI is available — proceed to the next check.
Otherwise — empty, an unresolved command string like `command -v codex 2>/dev/null` left in place by a non-Claude harness that doesn't process `!` pre-resolution, or any other non-path value — run `command -v codex` via the shell/Bash tool to verify at runtime. If that prints an absolute path, the Codex CLI is available; proceed. If it fails or prints nothing, emit "Codex CLI not found (install via `npm install -g @openai/codex` or `brew install codex`) -- using standard mode." and set `delegation_active` to false.

**3. Consent Flow**

If `consent_granted` is not true (from config `work_delegate_consent`):

Present a one-time consent warning using the platform's blocking question tool (`AskUserQuestion` in Claude Code, `request_user_input` in Codex, `ask_user` in Gemini, `ask_user` in Pi (requires the `pi-ask-user` extension)). The consent warning explains:
- Delegation sends implementation units to `codex exec` as a structured prompt
- **yolo mode** (`--dangerously-bypass-approvals-and-sandbox`): Full system access including network. Required for verification steps that run tests or install dependencies. **Recommended.**
- **full-auto mode** (`-s workspace-write`): Workspace-write sandbox, no network access by default. Network can be re-enabled by setting `network_access = true` under `[sandbox_workspace_write]` in `~/.codex/config.toml`.

Present the sandbox mode choice: (1) yolo (recommended), (2) full-auto.

On acceptance:
- Resolve the repo root: `git rev-parse --show-toplevel`. Write `work_delegate_consent: true` and `work_delegate_sandbox: <chosen-mode>` to `<repo-root>/.compound-engineering/config.local.yaml`
- To write: (1) if file or directory does not exist, create `<repo-root>/.compound-engineering/` and write the YAML file; (2) if file exists, merge new keys preserving existing keys
- Update `consent_granted` and `sandbox_mode` in the resolved state

On decline:
- Ask whether to disable delegation entirely for this project
- If yes: write `work_delegate: false` to `<repo-root>/.compound-engineering/config.local.yaml` (using the same repo root resolved above). To write: (1) if file or directory does not exist, create `<repo-root>/.compound-engineering/` and write the YAML file; (2) if file exists, merge new keys preserving existing keys. Set `delegation_active` to false, proceed in standard mode
- If no: set `delegation_active` to false for this invocation only, proceed in standard mode

**Headless consent:** If running in a headless or non-interactive context, delegation proceeds only if `work_delegate_consent` is already `true` in the config file. If consent is not recorded, set `delegation_active` to false silently.

## Batching

Delegate all units in one batch. If the plan exceeds 5 units, split into batches at the plan's own phase boundaries, or in groups of roughly 5 -- never splitting units that share files. Skip delegation entirely if every unit is trivial.

## Per-Batch Effort

Each batch picks an effort level proportional to its complexity, then resolves against the config floor before invocation.

**Effort levels — guidelines, not predicates**

Pick the level that best fits the batch. These are signals to weigh, not boxes to tick — use judgment.

- **default (no flag)** — trivial work with no behavioral change: a one-line config tweak, a rename, a typo or comment-only fix, a pure documentation update. Defers to the user's `~/.codex/config.toml` default (which is `medium` on a stock Codex install).
- **`medium`** — small, well-scoped behavioral changes that stay clear of high-risk areas. A handful of files, a single concern, no novel architecture.
- **`high`** — work that touches a high-risk area (auth/session logic, payments, database migrations, external API contracts, error handling with retries/fallbacks), or work spanning enough surface area that one mistake could cascade.
- **`xhigh`** — architectural work: cross-cutting refactors, multiple high-risk areas in the same batch, changes that propagate broadly, or anywhere a wrong call meaningfully degrades the project.

When in doubt, lean up one level — under-resourcing risky work costs more than over-resourcing routine work. Briefly note the picked level and the signal that drove it (e.g., "`high` — touches db/migrations") so the choice is auditable.

A few edge cases worth handling explicitly:
- **Test-only batches:** classify by what the tests *exercise*, not by file paths. Tests for auth flows, payment logic, or migrations get the same level the equivalent implementation work would get.
- **Mixed-complexity batches:** the batch picks one level. If a single batch combines a typo unit and a payments rewrite, pick the higher level. If the spread feels wasteful, prefer splitting at the batching step (see Batching above) over averaging it out.
- **Deletion-only batches:** classify by the risk of what is being removed, not by counts of remaining content. Removing an auth module is `high` even if the batch produces zero `Modify` content.
- **Documentation- or comment-only batches:** `default`.

**Floor and resolution — hard rules**

Effort levels are ordered: `minimal < low < medium < high < xhigh`.

Compute `effective_effort`:

- If `delegate_effort` is unset: `effective_effort = picked_level`.
- If `delegate_effort` is set: substitute `default` → `medium` in `picked_level`, then `effective_effort = max(picked_level, delegate_effort)`.

Emit based on `effective_effort`:

- `medium`, `high`, or `xhigh` → emit `-c 'model_reasoning_effort="<value>"'`.
- `default` → omit the flag (defer to `~/.codex/config.toml`). Reachable only when `delegate_effort` is unset and the pick is `default`.

Never pass the literal string `"default"` to `codex exec`.

Store `effective_effort` as a per-batch derived state value (alongside the session-level `delegate_effort`) and use it in place of `delegate_effort` throughout the Execution Loop.

## Prompt Template

At the start of delegated execution, create a per-run OS-temp scratch directory via `mktemp -d` and capture its **absolute path** for all downstream use. All scratch files for this invocation live under that directory. Do not use `.context/` — these scratch files are per-run throwaway that get cleaned up when delegated execution ends (see Cleanup below), matching the repo Scratch Space convention for one-shot artifacts. Do not pass unresolved shell-variable strings to non-shell tools (Write, Read); use the absolute path returned by `mktemp -d`.

```bash
SCRATCH_DIR="$(mktemp -d -t ce-work-codex-XXXXXX)"
echo "$SCRATCH_DIR"
```

Refer to the echoed absolute path as `<scratch-dir>` throughout the rest of this workflow.

Before each batch, write a prompt file to `<scratch-dir>/prompt-batch-<batch-num>.md`.

Build the prompt from the batch's implementation units using these XML-tagged sections:

```xml
<task>
[For a single-unit batch: Goal from the implementation unit.
For a multi-unit batch: list each unit with its Goal, stating the concrete
job, repository context, and expected end state for each.]
</task>

<files>
[Combined file list from all units in the batch -- files to create, modify, or read.]
</files>

<patterns>
[File paths from all units' "Patterns to follow" fields. If no patterns:
"No explicit patterns referenced -- follow existing conventions in the
modified files."]
</patterns>

<approach>
[For a single-unit batch: Approach from the unit.
For a multi-unit batch: list each unit's approach, noting dependencies
and suggested ordering.]
</approach>

<constraints>
- Do NOT run git commit, git push, or create PRs -- the orchestrating agent handles all git operations
- Restrict all modifications to files within the repository root
- Keep changes tightly scoped to the stated task -- avoid unrelated refactors, renames, or cleanup
- Resolve the task fully before stopping -- do not stop at the first plausible answer
- If you discover mid-execution that you need to modify files outside the repo root, complete what you can within the repo and report what you could not do via the result schema issues field
</constraints>

<testing>
Before writing tests, check whether the plan's test scenarios cover all
categories that apply to each unit. Supplement gaps before writing tests:
- Happy path: core input/output pairs from each unit's goal
- Edge cases: boundary values, empty/nil inputs, type mismatches
- Error/failure paths: invalid inputs, permission denials, downstream failures
- Integration: cross-layer scenarios that mocks alone won't prove

Write tests that name specific inputs and expected outcomes. If your changes
touch code with callbacks, middleware, or event handlers, verify the
interaction chain works end-to-end.
</testing>

<verify>
After implementing, run ALL test files together in a single command (not
per-file). Cross-file contamination (e.g., mocked globals leaking between
test files) only surfaces when tests run in the same process. If tests
fail, fix the issues and re-run until they pass. Do not report status
"completed" unless verification passes. This is your responsibility --
the orchestrator will not re-run verification independently.

[Test and lint commands from the project. Use the union of all units'
verification commands as a single combined invocation.]
</verify>

<output_contract>
Report your result via the --output-schema mechanism. Fill in every field:
- status: "completed" ONLY if all changes were made AND verification passes,
  "partial" if incomplete, "failed" if no meaningful progress
- files_modified: array of file paths you changed
- issues: array of strings describing any problems, gaps, or out-of-scope
  work discovered
- summary: one-paragraph description of what was done
- verification_summary: what you ran to verify (command and outcome).
  Example: "Ran `bun test` -- 14 tests passed, 0 failed."
  If no verification was possible, say why.
</output_contract>
```

## Result Schema

Write the result schema to `<scratch-dir>/result-schema.json` (using the absolute path captured at the start) once at the start of delegated execution:

```json
{
  "type": "object",
  "properties": {
    "status": { "enum": ["completed", "partial", "failed"] },
    "files_modified": { "type": "array", "items": { "type": "string" } },
    "issues": { "type": "array", "items": { "type": "string" } },
    "summary": { "type": "string" },
    "verification_summary": { "type": "string" }
  },
  "required": ["status", "files_modified", "issues", "summary", "verification_summary"],
  "additionalProperties": false
}
```

Each batch's result is written to `<scratch-dir>/result-batch-<batch-num>.json` via the `-o` flag. On plan failure, files are left in place for debugging.

If the result JSON is absent or malformed after a successful exit code, classify as task failure.

## Execution Loop

Initialize a `consecutive_failures` counter at 0 before the first batch.

**Clean-baseline preflight:** Before the first batch, verify there are no uncommitted changes to tracked files:

```bash
git diff --quiet HEAD
```

This intentionally ignores untracked files. Only staged or unstaged modifications to tracked files make rollback unsafe. However, if untracked files exist at paths in the batch's planned Files list, rollback (`git clean -fd -- <paths>`) would delete them. If such overlaps are detected, warn the user and recommend committing or stashing those files before proceeding.

If tracked files are dirty, stop and present options: (1) commit current changes, (2) stash explicitly (`git stash push -m "pre-delegation"`), (3) continue in standard mode (sets `delegation_active` to false). Do not auto-stash user changes.

**Delegation invocation:** For each batch, execute these as **separate Bash tool calls** (not combined into one):

**Step A — Launch (background, separate Bash call):**

Write the prompt file, then make a single Bash tool call with `run_in_background: true` set on the tool parameter. This call returns immediately and has no timeout ceiling.

Substitute the literal absolute path captured at setup for every `<scratch-dir>` below. Each Bash tool call starts a fresh shell, so the `$SCRATCH_DIR` variable from the setup snippet is not preserved — an unresolved `$SCRATCH_DIR` would expand empty and break result detection.

```bash
# Substitute the resolved sandbox_mode value (yolo or full-auto) from the skill state
SANDBOX_MODE="<sandbox_mode>"

# Resolve sandbox flag
if [ "$SANDBOX_MODE" = "full-auto" ]; then
  SANDBOX_FLAG="-s workspace-write"
else
  SANDBOX_FLAG="--dangerously-bypass-approvals-and-sandbox"
fi

codex exec \
  $SANDBOX_FLAG \
  --output-schema "<scratch-dir>/result-schema.json" \
  -o "<scratch-dir>/result-batch-<batch-num>.json" \
  - < "<scratch-dir>/prompt-batch-<batch-num>.md"
```

**Conditional flags** — only include each line when the corresponding skill-state value is set:

- If `delegate_model` is set, insert `  -m "<delegate_model>" \` as a line before `$SANDBOX_FLAG`.
- If `effective_effort` is `medium`, `high`, or `xhigh` (resolved via Per-Batch Effort above), insert `  -c 'model_reasoning_effort="<effective_effort>"' \` as a line before `$SANDBOX_FLAG`. When `effective_effort` is `default` (only possible when `delegate_effort` is unset and the pick is `default`), omit the line — never pass the literal string `"default"`.

When either value is unset, omit its line entirely — Codex resolves the default from the user's `~/.codex/config.toml` (and ultimately the CLI's own built-in default). Do not substitute a placeholder string for unset values.

Critical: `run_in_background: true` must be set as a **Bash tool parameter**, not as a shell `&` suffix. The tool parameter is what removes the timeout ceiling. A shell `&` inside a foreground Bash call still hits the 2-minute default timeout.

Quoting is critical for the `-c` flag when present: use single quotes around the entire key=value and double quotes around the TOML string value inside. Example: `-c 'model_reasoning_effort="high"'`.

Do not improvise CLI flags or modify this invocation template beyond the documented conditional insertions.

**Step B — Poll (foreground, separate Bash calls):**

After the launch call returns, make a **new, separate** foreground Bash tool call that polls for the result file. This keeps the agent's turn active so the user cannot interfere with the working tree.

Substitute the literal absolute path captured at setup for `<scratch-dir>`. The shell variable from Step A does not survive across separate Bash tool calls.

```bash
RESULT_FILE="<scratch-dir>/result-batch-<batch-num>.json"
for i in $(seq 1 6); do
  test -s "$RESULT_FILE" && echo "DONE" && exit 0
  sleep 10
done
echo "Waiting for Codex..."
```

If the output is "Waiting for Codex...", issue the same polling command again as another separate Bash call. Repeat until the output is "DONE", then read the result file and proceed to classification.

**Polling termination conditions:** Stop polling when any of these conditions is met:

- **Result file appears** (output is "DONE") -- proceed to result classification normally.
- **Background process exits with non-zero code** -- classify as CLI failure (row 1). Rollback and fall back to standard mode.
- **Background process exits with zero code but result file is absent** -- classify as task failure (row 2: exit 0, result JSON missing). Rollback and increment `consecutive_failures`.
- **5 polling rounds** elapse (~5 minutes) without the result file appearing and without a background process notification -- treat as a hung process. Classify as CLI failure (row 1). Rollback and fall back to standard mode.

**Result classification:** Codex is responsible for running verification internally and fixing failures before reporting -- the orchestrator does not re-run verification independently.

| # | Signal | Classification | Action |
|---|--------|---------------|--------|
| 1 | Exit code != 0 | CLI failure | Rollback to HEAD. Fall back to standard mode for ALL remaining work. |
| 2 | Exit code 0, result JSON missing or malformed | Task failure | Rollback to HEAD. Increment `consecutive_failures`. |
| 3 | Exit code 0, `status: "failed"` | Task failure | Rollback to HEAD. Increment `consecutive_failures`. |
| 4 | Exit code 0, `status: "partial"` | Partial success | Keep the diff. Complete remaining work locally, verify, and commit. Increment `consecutive_failures`. |
| 5 | Exit code 0, `status: "completed"` | Success | Commit changes. Reset `consecutive_failures` to 0. |

**Result handoff — surface to user:** After reading the result JSON and before committing or rolling back, display a summary so the user sees what happened. Format:

> **Codex batch <batch-num> — <classification>**
> <summary from result JSON>
>
> **Files:** <comma-separated list from files_modified>
> **Verification:** <verification_summary from result JSON>
> **Issues:** <issues list, or "None">

On failure or partial results, include the classification reason (e.g., "status: failed", "result JSON missing") so the user understands why the orchestrator is rolling back or completing locally.

Keep this brief — the goal is transparency, not a wall of text. One short block per batch.

**Rollback procedure:**

```bash
git checkout -- .
git clean -fd -- <paths from the batch's combined Files list>
```

Do NOT use bare `git clean -fd` without path arguments.

**Commit on success:**

```bash
git add $(git diff --name-only HEAD; git ls-files --others --exclude-standard)
git commit -m "feat(<scope>): <batch summary>"
```

**Between batches** (plans split into multiple batches): Report what completed, test results, and what's next. Continue immediately unless the user intervenes -- the checkpoint exists so the user *can* steer, not so they *must*.

**Circuit breaker:** After 3 consecutive failures, set `delegation_active` to false and emit: "Codex delegation disabled after 3 consecutive failures -- completing remaining units in standard mode."

**Scratch cleanup:** No explicit cleanup needed — OS temp handles eventual cleanup (macOS `$TMPDIR` periodic purge; Linux/WSL `/tmp` reboot or periodic cleanup). Leaving `<scratch-dir>` in place after the run also preserves intermediate artifacts for debugging if anything went wrong.

## Mixed-Model Attribution

When some units are executed by Codex and others locally:
- If all units used delegation: attribute to the Codex model
- If all units used standard mode: attribute to the current agent's model
- If mixed: note which units were delegated in the PR description and credit both models
