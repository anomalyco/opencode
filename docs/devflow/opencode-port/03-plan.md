# Implementation Plan: OpenCode Port for Devflow

**Proposal:** 02-proposal.md
**Status:** Draft

## Operating Principle

OpenCode is the long-term target. Claude Code remains supported because it is
the current working harness and because users with Claude Code adherence
problems need the safeguards now. Do not make new architecture Claude-shaped
unless OpenCode can consume the same contract through an adapter.

The port has two parallel tracks:

1. **Devflow adapter work** in this repository: install transforms, OpenCode
   plugin adapter, rule loading, agent conversion, parity tests.
2. **OpenCode fork work** in a fork of `anomalyco/opencode`: curated PR stack
   for missing lifecycle and plugin primitives, rebased regularly onto upstream
   `dev`.

No port work is complete unless both tracks have documentation that explains
what changed, what gap it closes, and what parity remains missing.

## Current Claude Code Enforcement Surface

The current Claude Code plugin is not just prompts. It has three layers.

### Behavioral Layer

| Primitive | Current Claude Mechanism | OpenCode Target |
|---|---|---|
| Rules | Installed rule files plus agent startup instructions | Explicit `opencode.json` `instructions` plus fail-closed `AGENTS.md` |
| Agents | Markdown agents with Claude `tools` arrays | Markdown agents with OpenCode `permission` objects |
| Skills | `skills/<name>/SKILL.md` | Native OpenCode skills under `skills/<name>/SKILL.md` |
| Commands | Claude markdown commands under `commands/` | OpenCode markdown commands with converted frontmatter |

### Structural Layer

Current hook registration is in `hooks/hooks.json`. Python hook commands now
point at `src/devflow/...` with `PYTHONPATH="${CLAUDE_PLUGIN_ROOT}/src"`.

| Claude Event | Current Hook Chain | Purpose | OpenCode Equivalent |
|---|---|---|---|
| `PreToolUse` all tools | `hooks/reinforce.sh` | Reinforce core principles before tool use | Prefer `session.start`, `system transform`, or compaction hook; avoid per-tool spam if OpenCode can keep instructions stable |
| `PreToolUse Edit/Write/MultiEdit` | `orchestrator_dispatch`, `worktree_isolation`, `criteria_coverage_gate`, `commit_order`, `phase_gate`, `workflow_gate` | Block direct orchestrator writes, enforce worktree, criteria, TDD order, phase, workflow gates | OpenCode `tool.execute.before` adapter, blocking by throwing on hook exit 2 |
| `PreToolUse Bash` | `orchestrator_dispatch`, `worktree_isolation`, `commit_order`, `block_bash_file_writes`, `test_before_commit`, `artifact_sequence_check`, `initiative_structure_check`, `initiative_content_check` | Block orchestrator shell, worktree bypass, TDD/order violations, bash file writes, bad commits/artifacts | OpenCode `tool.execute.before` adapter for `bash` |
| `PostToolUse Edit/Write/MultiEdit` | `record_tool_call`, `record_artifact_event` | Tool telemetry and artifact event telemetry | OpenCode `tool.execute.after` adapter |
| `PostToolUse Bash` | `record_tool_call`, `record_phase_timing` | Shell telemetry and phase timing | OpenCode `tool.execute.after` adapter; prefer PR `#21150` for final MCP output timing |
| `PostToolUse Read/Grep/Glob` | `record_tool_call` | Read/search telemetry | OpenCode `tool.execute.after` adapter |
| `SessionStart` | `record_session`, `session_summary` | Session telemetry and summaries | OpenCode `session.start` from PR `#15224`, plus existing session events if available |
| `SessionStart compact` | `reinforce-on-compact.sh` | Reinject core rules after compaction | OpenCode `experimental.session.compacting` plugin hook |
| `SubagentStart` | `record_agent_start` | Agent dispatch telemetry | OpenCode task/tool hooks with PR `#15412` parent agent context |
| `SubagentStop` | `log_agent_completion` | Agent completion telemetry for gates | OpenCode task/session events; may need fork support for child session status |
| `Stop` | `stop-hook.sh` | Loop continuation / promise checking | OpenCode `session.stopping` from PR `#16598` |

### Verification Layer

The current workflow relies on independent reviewers, verifiers, completion
reports, and phase gates. These are mostly prompt/agent/skill contracts and can
carry to OpenCode once agents, skills, commands, and task invocation work.

## OpenCode-Specific Enforcement Design Changes

Some parts should work differently in OpenCode while preserving the same level
of enforcement.

1. **Use OpenCode permissions as a first line of defense.**
   Claude relies heavily on hooks to stop the orchestrator from editing. In
   OpenCode, define a `devflow-orchestrator` primary agent with `edit: deny`,
   constrained `bash`, and `task` allowed only for devflow subagents. Keep hook
   enforcement as the authoritative second line.

2. **Use `opencode.json` `instructions` for mandatory rules.**
   Do not depend on implicit `.claude/rules/` compatibility. OpenCode can read
   explicit instruction files now. This is more deterministic than rule folder
   discovery.

3. **Use native OpenCode skill discovery.**
   Skills already match the `SKILL.md` structure. Install them natively under
   OpenCode's `skills/` directory instead of routing them through Claude paths.

4. **Convert agents at install time.**
   Keep canonical agent markdown, but generate OpenCode-valid frontmatter.
   Avoid `model: opus` and `model: sonnet` aliases unless the user supplies an
   explicit OpenCode model mapping.

5. **Map OpenCode `apply_patch` explicitly.**
   Claude has `MultiEdit`; OpenCode has `apply_patch`. The adapter must parse
   patch paths and run the same write enforcement. Treating `apply_patch` as a
   simple edit without extracting paths would be an enforcement gap.

6. **Prefer lifecycle hooks over per-tool reinforcement.**
   Claude uses `reinforce.sh` on every pre-tool event. In OpenCode, use
   `session.start` and compaction hooks for stable context. Keep per-tool
   reinforcement only if adherence measurements show regression.

7. **Implement loop continuation with `session.stopping`.**
   Claude's `Stop` hook returns continuation prompts. OpenCode should use the
   `session.stopping` PR behavior: plugin injects a follow-up user message and
   sets stop false when the devflow loop should continue.

8. **Make telemetry harness-aware.**
   Existing telemetry must record `harness=opencode` for OpenCode events. The
   adapter should supply the harness field, and Python telemetry should default
   to Claude only when no harness is provided.

9. **Keep hook scripts as the shared enforcement core.**
   The OpenCode plugin should adapt event payloads and subprocess execution;
   it should not fork enforcement logic into JavaScript unless a Python hook is
   impossible to reuse.

## Documentation System

Add and maintain the following flat artifacts under
`docs/devflow/opencode-port/`.

| Artifact | Purpose | Update Rule |
|---|---|---|
| `02-proposal.md` | Contract for the port | Update only through proposal review/change control |
| `03-plan.md` | Execution plan and task breakdown | Update whenever tasks or sequencing change |
| `opencode-fork-prs.md` | PR absorption manifest for the OpenCode fork | Update before and after applying any upstream PR |
| `parity-matrix.md` | Claude Code vs OpenCode parity status | Update after each implementation milestone |
| `gap-log.md` | Detailed gap ledger with owner, severity, and closure evidence | Update whenever a new gap is found or closed |
| `rebase-log.md` | Fork rebase history and conflicts | Update on every fork rebase onto upstream OpenCode |
| `verification-log.md` | Commands run and evidence collected | Update before claiming any parity milestone |

These files are not optional project management ceremony. They are the control
surface that prevents the fork and adapter from drifting.

## OpenCode Fork Workflow

### Branches

Use a dedicated fork with this branch model:

| Branch | Purpose |
|---|---|
| `upstream-dev` | Mirror of `anomalyco/opencode:dev`; never commit directly |
| `devflow/base` | Fast-forward or reset mirror of `upstream-dev` for rebases |
| `devflow/pr-<number>-<short-name>` | One branch per absorbed upstream PR |
| `devflow/hojo` | Linear stack of absorbed PRs plus minimal devflow-specific glue |
| `devflow/release` | Tested branch used by devflow users |

### Applying PRs

For each upstream PR:

1. Record it in `opencode-fork-prs.md` with upstream PR number, title, URL,
   status, reason, expected devflow gap closure, and risk.
2. Apply it to an isolated `devflow/pr-*` branch first.
3. Run upstream OpenCode tests relevant to that PR.
4. Merge or cherry-pick into `devflow/hojo` only after tests pass.
5. Record resulting fork commit SHA in `opencode-fork-prs.md`.
6. Update `gap-log.md` and `parity-matrix.md` with what actually improved.

### Monitoring Upstream PRs

Add a small script or manual checklist that runs:

```bash
gh pr view <number> --repo anomalyco/opencode --json number,state,mergedAt,closedAt,headRefOid,title,url
```

For every PR in `opencode-fork-prs.md`, track:

| Field | Meaning |
|---|---|
| `upstreamState` | `OPEN`, `MERGED`, `CLOSED` |
| `upstreamHead` | Last seen upstream head SHA |
| `forkCommit` | Commit SHA applied in our fork |
| `absorbedVersion` | OpenCode fork branch/release containing it |
| `dropWhen` | Condition for removing local patch, usually upstream merge plus rebase |

If a PR merges upstream, the next rebase should remove the local copy and note
the removal in `rebase-log.md`. If a PR closes unmerged, decide whether to keep
it as a devflow-owned patch or replace it.

### Rebase Cadence

Rebase `devflow/hojo` onto upstream `dev` at least weekly while the
port is active, and immediately before any devflow release that depends on the
fork.

Every rebase must update `rebase-log.md` with:
- upstream base SHA before and after
- local patch count before and after
- conflicts encountered
- resolution summary
- tests run
- PRs dropped because upstream merged them
- PRs retained because upstream still lacks them

## Initial Upstream PR Stack

### Must Absorb

| PR | Gap Closed | Validation |
|---|---|---|
| `#16598` `session.stopping` | `/loop` continuation / Claude `Stop` parity | Synthetic plugin injects one follow-up message and stops on second pass |
| `#15412` parent agent context | Agent identity and orchestrator/subagent boundary tracking | Tool hook input includes agent and parent agent for subagent tool call |
| `#19470` `permission.ask` | Policy participation in permission flow | Plugin can allow, deny, and fall back to ask |
| `#22654` `ask()` in `tool.execute.before` | Interactive pre-tool enforcement path | Pre-tool plugin can ask instead of throwing |
| `#20053` mutable tool args | Argument normalization before execution | Plugin mutation changes executed args |
| `#21150` post-MCP after hook timing | Accurate post-tool telemetry | `tool.execute.after` sees assembled MCP output |

### Should Absorb

| PR | Gap Closed | Validation |
|---|---|---|
| `#15224` `session.start` | SessionStart-like telemetry/context injection | Plugin receives first-message session start |
| `#23650` turn completed event | Per-turn telemetry and future review UX | Event fires after tool loop, before compaction |
| `#19519` AI-visible post-tool messages | Hook feedback to agent | Post-tool hook injects visible message |
| `#21773` shell env context | Agent/session-aware hook subprocess env | `shell.env` receives message and agent |
| `#21776` bash command timeout exemptions | Long-running devflow helper CLI support | Registered command runs without normal timeout |
| `#17517` plugin event awaiting/error handling | Plugin reliability | Plugin async errors do not corrupt database effects |

### Rules PR Choice

Start with `#18903` if we want a small native `.opencode/rules/*` loader.
Evaluate `#10090` only after baseline port works because it is broader and may
conflict with instruction loading. Devflow mandatory rules still use explicit
`opencode.json` `instructions` either way.

## Criteria Mapping

| AC# | Criterion | Tasks | Status |
|---|---|---|---|
| 1 | OpenCode install works with `--root <tmp>` | T2, T3, T4 | Not Started |
| 2 | Default root is `~/.config/opencode` | T2 | Not Started |
| 3 | `opencode.json` instructions include mandatory rules | T3 | Not Started |
| 4 | `AGENTS.md` fail-closed rule contract exists | T3 | Not Started |
| 5 | No reliance on `~/.claude/rules/` | T3, T12 | Not Started |
| 6 | `opencode agent list` succeeds | T4 | Not Started |
| 7 | Agents use OpenCode frontmatter | T4 | Not Started |
| 8 | Model aliases do not break OpenCode | T4 | Not Started |
| 9 | Skills install under OpenCode | T5 | Not Started |
| 10 | `/flow` command installs without Claude placeholders | T6 | Not Started |
| 11 | Claude install remains unchanged | T2, T13 | Not Started |
| 12 | OpenCode plugin adapter exists | T7 | Not Started |
| 13 | Adapter maps pre-tool hooks | T8 | Not Started |
| 14 | Adapter blocks on hook exit 2 | T8 | Not Started |
| 15 | Adapter maps post-tool telemetry hooks | T9 | Not Started |
| 16 | Telemetry records `harness=opencode` | T9 | Not Started |
| 17 | Telemetry failures do not block | T9 | Not Started |
| 18 | Adapter normalizes tool names and inputs | T7, T8, T9 | Not Started |
| 19 | Existing Python hook tests pass | T1, T13 | Not Started |
| 20 | `/loop` support documented as partial unless fork hook exists | T10, T12 | Not Started |

## Task Definitions

### T1: Establish Baseline and Freeze Current Enforcement Surface

- **Criteria:** AC19
- **Depends:** none
- **Files:**
  - `docs/devflow/opencode-port/parity-matrix.md` (new)
  - `docs/devflow/opencode-port/gap-log.md` (new)
  - `docs/devflow/opencode-port/verification-log.md` (new)

**Steps:**
1. RED: Add a parity matrix row for every hook/event in `hooks/hooks.json` and
   mark OpenCode status as `unknown`.
2. GREEN: Run the current Python hook test suite with `PYTHONPATH=src` and
   record exact passing/failing commands in `verification-log.md`.
3. COMMIT: Commit documentation first, then any fixes required to make baseline
   tests pass.

**Done when:** Baseline Claude enforcement surface is documented and current
hook tests have recorded evidence.

### T2: Correct OpenCode Install Root and Preserve Claude Install

- **Criteria:** AC1, AC2, AC11
- **Depends:** T1
- **Files:**
  - `scripts/install/install.py` (edit)
  - `tests/test-install.sh` or pytest equivalent (edit)

**Steps:**
1. RED: Add installer test expecting OpenCode default global root semantics and
   `--root` override behavior.
2. GREEN: Change OpenCode default root to `~/.config/opencode` and preserve
   Claude behavior.
3. COMMIT: test first, then implementation.

**Done when:** Claude and OpenCode install tests pass and OpenCode no longer
defaults to `~/.opencode`.

### T3: Add Explicit OpenCode Rule Loading

- **Criteria:** AC3, AC4, AC5
- **Depends:** T2
- **Files:**
  - `scripts/install/install.py` (edit)
  - `manifests/install-modules.json` (edit)
  - tests for generated `opencode.json` and `AGENTS.md` (new/edit)

**Steps:**
1. RED: Test OpenCode install produces `opencode.json` with mandatory
   `instructions` entries and a fail-closed `AGENTS.md`.
2. GREEN: Generate or safely merge `opencode.json`; generate `AGENTS.md` rule
   contract.
3. COMMIT: test first, then implementation.

**Done when:** Mandatory rules are explicitly loaded without `.claude/rules/`.

### T4: Convert Agents for OpenCode

- **Criteria:** AC6, AC7, AC8
- **Depends:** T3
- **Files:**
  - `scripts/install/install.py` (edit)
  - agent transform tests (new/edit)

**Steps:**
1. RED: Test disposable OpenCode install fails if agent frontmatter contains
   Claude `tools: ["Read"]` arrays.
2. GREEN: Transform agent frontmatter to OpenCode `permission` objects and omit
   unsupported model aliases unless configured.
3. COMMIT: test first, then implementation.

**Done when:** `OPENCODE_CONFIG_DIR=<tmp> opencode agent list` succeeds.

### T5: Install Skills for OpenCode

- **Criteria:** AC9
- **Depends:** T3
- **Files:**
  - `manifests/install-modules.json` (edit)
  - install tests (edit)

**Steps:**
1. RED: Test OpenCode install includes representative workflow and domain
   skills.
2. GREEN: Add OpenCode to skill module targets.
3. COMMIT: test first, then implementation.

**Done when:** OpenCode install contains all devflow skills under `skills/`.

### T6: Port `/flow` Command First

- **Criteria:** AC10
- **Depends:** T3, T4, T5
- **Files:**
  - `commands/flow.md` or generated OpenCode command transform (edit)
  - install tests (edit)

**Steps:**
1. RED: Test OpenCode installed `/flow` command contains no
   `${CLAUDE_PLUGIN_ROOT}`, `allowed-tools`, or unsupported Claude-only fields.
2. GREEN: Add command transform or OpenCode-specific generated command.
3. COMMIT: test first, then implementation.

**Done when:** OpenCode can load `/flow` command from installed config.

### T7: Build OpenCode Plugin Adapter Skeleton

- **Criteria:** AC12, AC18
- **Depends:** T1
- **Files:**
  - `plugins/opencode/devflow.js` or `plugins/opencode/devflow.ts` (new)
  - `scripts/install/install.py` (edit)
  - install tests (edit)

**Steps:**
1. RED: Test OpenCode install includes the plugin adapter and plugin can load in
   a minimal OpenCode config.
2. GREEN: Create adapter with path resolution, subprocess execution helper, and
   canonical payload builder.
3. COMMIT: test first, then implementation.

**Done when:** Adapter loads without changing behavior.

### T8: Implement Blocking Pre-Tool Enforcement Adapter

- **Criteria:** AC13, AC14, AC18
- **Depends:** T7
- **Files:**
  - `plugins/opencode/devflow.js` or `.ts` (edit)
  - adapter tests (new)

**Steps:**
1. RED: Synthetic OpenCode `tool.execute.before` payload for disallowed write
   does not block.
2. GREEN: Map OpenCode tools to canonical hook payloads and throw when any
   canonical hook exits 2.
3. COMMIT: test first, then implementation.

**Done when:** Synthetic disallowed writes and bash file writes are blocked.

### T9: Implement Post-Tool Telemetry Adapter

- **Criteria:** AC15, AC16, AC17, AC18
- **Depends:** T7
- **Files:**
  - `plugins/opencode/devflow.js` or `.ts` (edit)
  - `src/devflow/telemetry/*.py` where harness is hardcoded (edit)
  - adapter/telemetry tests (new/edit)

**Steps:**
1. RED: Test telemetry records use `claude` when invoked from OpenCode payload.
2. GREEN: Pass and persist `harness=opencode`; make telemetry hook failures
   non-blocking in adapter.
3. COMMIT: test first, then implementation.

**Done when:** OpenCode tool telemetry records as OpenCode and failures do not
block.

### T10: Add `/loop` Parity Behind Fork Capability Check

- **Criteria:** AC20
- **Depends:** T7, fork PR `#16598`
- **Files:**
  - OpenCode plugin adapter (edit)
  - command transform for `loop.md` (edit)
  - `docs/devflow/opencode-port/parity-matrix.md` (edit)

**Steps:**
1. RED: Document `/loop` as partial without `session.stopping` support.
2. GREEN: If fork supports `session.stopping`, implement one-shot loop
   continuation using devflow loop state and promise detection.
3. COMMIT: documentation first, then implementation.

**Done when:** `/loop` is either working on the fork or explicitly marked as
partial with exact blocker.

### T11: Establish OpenCode Fork Tracking

- **Criteria:** supports all fork-dependent ACs
- **Depends:** none
- **Files:**
  - `docs/devflow/opencode-port/opencode-fork-prs.md` (new)
  - `docs/devflow/opencode-port/rebase-log.md` (new)
  - optional monitoring script under `scripts/` (new)

**Steps:**
1. RED: Create PR tracker with all required PRs marked `not applied` and no
   fork SHA.
2. GREEN: Add monitoring command/process and fill initial upstream state.
3. COMMIT: documentation first, then optional script.

**Done when:** Every candidate PR has status, rationale, gap mapping, and
monitoring fields.

### T12: Update User-Facing Documentation

- **Criteria:** AC5, AC20
- **Depends:** T3, T6, T10
- **Files:**
  - `docs/guide.md` (edit)
  - `AGENTS.md` if directory structure changes (edit)

**Steps:**
1. RED: Identify stale claims that OpenCode is fully supported.
2. GREEN: Document OpenCode support level, install command, rule loading, fork
   requirement if applicable, and partial `/loop` status.
3. COMMIT: documentation change.

**Done when:** User docs accurately describe OpenCode support and limitations.

### T13: Full Verification Matrix

- **Criteria:** AC1-AC20
- **Depends:** T1-T12
- **Files:**
  - `docs/devflow/opencode-port/verification-log.md` (edit)
  - `docs/devflow/opencode-port/parity-matrix.md` (edit)

**Steps:**
1. Run Claude install tests.
2. Run OpenCode install tests.
3. Run `OPENCODE_CONFIG_DIR=<tmp> opencode agent list`.
4. Run Python hook tests with `PYTHONPATH=src`.
5. Run OpenCode adapter tests.
6. Record all evidence.

**Done when:** Every acceptance criterion is mapped to passing evidence or an
explicit documented limitation.

## Agent Context

Implementation agents must treat OpenCode as the strategic target and Claude
Code as a compatibility target. Do not remove Claude support. Do not duplicate
canonical prompts or enforcement logic. Prefer transforms and adapters.

Important commands:

```bash
PYTHONPATH=src python3 -m pytest
./install.sh --target claude --root /tmp/devflow-claude-test install
./install.sh --target opencode --root /tmp/devflow-opencode-test install
OPENCODE_CONFIG_DIR=/tmp/devflow-opencode-test opencode agent list
```

Important constraints:
- No claim of OpenCode parity without evidence in `verification-log.md`.
- No absorbed OpenCode fork PR without an entry in `opencode-fork-prs.md`.
- No dropped fork patch without an entry in `rebase-log.md`.
- No implicit rule loading. Mandatory rules must be explicit in `opencode.json`
  `instructions`.
- No JavaScript copy of Python enforcement logic unless a specific hook cannot
  be adapted.

## Reset History

This section is populated automatically when a reset occurs.
