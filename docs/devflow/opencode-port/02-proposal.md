# OpenCode Port for Devflow

## Problem

Devflow currently has a Claude Code plugin and a nominal OpenCode installer
target, but the OpenCode target is not functionally equivalent.

Evidence from the current codebase:
- `.claude-plugin/plugin.json` is the only plugin manifest.
- `manifests/install-modules.json` installs only rules and agents for the
  OpenCode target.
- `scripts/install/install.py` copies OpenCode files directly to
  `~/.opencode`, while current OpenCode uses `~/.config/opencode` for global
  config and `.opencode/` for project-local config.
- A disposable OpenCode install fails validation with `opencode agent list`
  because existing agent frontmatter uses Claude-style `tools: ["Read", ...]`,
  while OpenCode expects permission/tool objects.
- Claude hook configuration in `hooks/hooks.json` uses `CLAUDE_PLUGIN_ROOT` and
  Claude hook event names. OpenCode does not consume that file directly.

The biggest correctness risk is rule loading. Devflow rules are mandatory, but
current OpenCode does not document support for `~/.claude/rules/`. OpenCode
does support:
- `AGENTS.md` in the project.
- `~/.config/opencode/AGENTS.md` globally.
- `CLAUDE.md` and `~/.claude/CLAUDE.md` as compatibility fallbacks.
- `opencode.json` `instructions` entries for explicit instruction files and
  glob patterns.
- `~/.claude/skills/` compatibility for skills.

There is an upstream OpenCode PR, `anomalyco/opencode#10090`, that adds
context-aware `.claude/rules/` compatibility, but it is open and must not be a
dependency for the initial port. The initial port must explicitly wire rules
through OpenCode-supported mechanisms.

## Design

### Strategic Direction

OpenCode is the long-term target harness for devflow. Claude Code support
remains important, but it is not the destination architecture.

The purpose of maintaining Claude Code compatibility is pragmatic:
- Claude Code is the current working harness.
- Many users have adherence problems with Claude Code and benefit from
  devflow's structural safeguards.
- Existing Claude Code workflows prove the value of rules, agents, skills,
  hooks, and commands as a coherent system.

The port must preserve the workflows, structure, agents, and enforcement model
that make devflow useful, but new architectural decisions should bias toward
OpenCode as the primary platform. Claude Code should be treated as one adapter
over shared devflow primitives, not as the canonical runtime model.

This matters because devflow exists specifically to compensate for errant or
non-adherent coding agents. Behavioral prompts are not enough. The port is not
complete when OpenCode can merely read the prompts; it is complete when
OpenCode can enforce the workflow boundaries that make the system reliable.

Future work may add another agent or harness beyond OpenCode. The structure
introduced here should make that possible by keeping devflow's core contracts
harness-neutral and moving harness-specific behavior into adapters.

### Goal

Support Claude Code and OpenCode from the same devflow repository without
forking the rule, agent, skill, command, or hook logic.

Claude Code remains supported for current users and for people who need
adherence safeguards in that harness. OpenCode becomes the primary long-term
target with a first-class adapter layer.

### Non-Goals

- Do not replace the Python enforcement hooks during this port.
- Do not require unreleased OpenCode PRs for the baseline `/flow` experience.
- Do not make OpenCode consume `hooks/hooks.json` directly.
- Do not duplicate canonical rules, agents, skills, or hook scripts by hand.

### Porting Strategy

Keep canonical devflow content in the existing directories:

```
rules/       canonical mandatory instructions
agents/      canonical agent prompts
skills/      canonical reusable skills
commands/    canonical slash-command prompts where portable
hooks/       canonical enforcement and telemetry scripts
scripts/     canonical runtime helpers
```

Add harness adapters at install time:
- Claude adapter preserves current behavior.
- OpenCode adapter transforms paths and frontmatter into OpenCode-native
  formats.
- OpenCode plugin adapter maps OpenCode plugin events to the canonical devflow
  hook payload consumed by existing Python scripts.

### OpenCode Layout

Default global install root:

```
~/.config/opencode/
  AGENTS.md
  opencode.json
  agents/
  commands/
  skills/
  plugins/devflow.js
  devflow/
    install-state.json
    rules/
    hooks/
    scripts/
    kaizen/
```

Project-local install root when requested:

```
.opencode/
  AGENTS.md
  opencode.json
  agents/
  commands/
  skills/
  plugins/devflow.js
  devflow/
    rules/
    hooks/
    scripts/
```

The installer must support `--root` for tests and must not hardcode the user's
real home directory into test expectations.

### Rule Loading Contract

OpenCode must receive devflow rules through supported mechanisms, not through
assumed `~/.claude/rules/` compatibility.

The OpenCode installer writes an `AGENTS.md` that says devflow rules are
mandatory and points to the installed rule files. It also writes or merges an
`opencode.json` `instructions` list containing the installed rule paths.

Example generated config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "instructions": [
    "devflow/rules/devflow.md",
    "devflow/rules/proposals.md",
    "devflow/rules/research.md",
    "devflow/rules/accountability.md",
    "devflow/rules/maven.md"
  ]
}
```

Generated `AGENTS.md` must include a short fail-closed instruction:

```markdown
# Devflow

The files listed in `opencode.json` `instructions` under `devflow/rules/` are
mandatory constraints. If they are unavailable, stop and report that the
devflow OpenCode installation is broken instead of proceeding.
```

This makes rule loading explicit and testable. If upstream `.claude/rules/`
compatibility lands later, it can be an optimization, not the source of truth.

### Agent Conversion

Existing agents use Claude frontmatter:

```yaml
tools: ["Read", "Write", "Edit", "Bash", "Grep", "Glob"]
model: sonnet
```

OpenCode agents need OpenCode frontmatter:

```yaml
mode: subagent
permission:
  read: allow
  edit: allow
  bash: allow
  grep: allow
  glob: allow
```

The installer transforms agent frontmatter for the OpenCode target.

Mapping:

| Claude Tool | OpenCode Permission |
|---|---|
| `Read` | `read: allow` |
| `Write`, `Edit`, `MultiEdit` | `edit: allow` |
| `Bash` | `bash: allow` |
| `Grep` | `grep: allow` |
| `Glob` | `glob: allow` |
| `Task` | `task: allow` |
| `Skill` | `skill: allow` |
| `WebFetch` | `webfetch: allow` |
| `WebSearch` | `websearch: allow` |

Model aliases (`opus`, `sonnet`) must either be omitted for OpenCode or mapped
through installer configuration. The initial port should omit model overrides
unless a target model is explicitly configured, so OpenCode inherits the user's
chosen model.

### Skills

OpenCode natively supports agent skills using `skills/<name>/SKILL.md` with
the same basic `name` and `description` frontmatter used by devflow.

The OpenCode target should install all devflow skills under `skills/`, not only
agents and rules. This includes workflow phase skills and cross-cutting skills
such as TDD, systematic debugging, completion reports, parallel agents, code
review, Maven optimization, SVG diagrams, quality audit, and documentation.

### Commands

OpenCode supports markdown commands under `commands/`. The initial command
port should include `/flow` first because it is prompt-driven and does not
depend on Claude stop-hook behavior.

OpenCode command conversion must:
- Preserve `description`.
- Drop Claude-only fields such as `argument-hint` if OpenCode ignores or
  rejects them.
- Drop or rewrite `allowed-tools` because OpenCode uses `permission`, not
  Claude command-level tool gates.
- Replace `${CLAUDE_PLUGIN_ROOT}` usage with OpenCode-compatible generated
  paths or avoid shell blocks entirely.

`/loop`, `/loop-status`, and `/loop-cancel` are phase two because the current
loop model depends on Claude `Stop` hook behavior.

### OpenCode Plugin Adapter

OpenCode plugins are JavaScript/TypeScript modules. The port adds a generated
or source-controlled plugin adapter at `plugins/opencode/devflow.js` and
installs it into OpenCode's plugin directory.

The adapter responsibilities:
- Subscribe to `tool.execute.before` and invoke canonical pre-tool hook chain.
- Subscribe to `tool.execute.after` and invoke canonical post-tool telemetry
  hook chain.
- Normalize OpenCode tool input into the canonical devflow JSON shape:

```json
{
  "harness": "opencode",
  "session_id": "...",
  "agent_id": "...",
  "agent_type": "...",
  "tool_name": "Write",
  "tool_input": {},
  "cwd": "..."
}
```

- Convert OpenCode tool names to canonical names:

| OpenCode Tool | Canonical Tool |
|---|---|
| `read` | `Read` |
| `write` | `Write` |
| `edit` | `Edit` |
| `apply_patch` | `MultiEdit` or `ApplyPatch` after hook support is added |
| `bash` | `Bash` |
| `grep` | `Grep` |
| `glob` | `Glob` |
| `task` | `Task` |
| `skill` | `Skill` |
| `webfetch` | `WebFetch` |
| `websearch` | `WebSearch` |

- Run Python hooks as subprocesses with stdin JSON.
- If any pre-tool hook exits `2`, throw from `tool.execute.before` so OpenCode
  blocks the tool call.
- Never let telemetry hook failures block work.

The adapter must not rely on OpenCode consuming Claude's `hooks/hooks.json`.
Instead, it may reuse the hook chain definitions by reading `hooks/hooks.json`
as devflow-owned configuration and translating matcher names internally.

### Enforcement Gaps and Upstream Dependencies

Baseline OpenCode port can enforce tool calls with the documented
`tool.execute.before` hook. Exact Claude parity needs upstream work.

It is acceptable to maintain a devflow OpenCode fork while upstream PRs are
pending, provided the fork uses a small, explicit compatibility patch stack and
every absorbed PR has a devflow-specific reason. Do not absorb broad unrelated
OpenCode feature work.

### OpenCode Fork Patch Stack

The fork should start from the latest upstream `anomalyco/opencode` `dev`
branch, then apply a curated set of PRs in compatibility layers.

#### Must Absorb

These PRs close direct gaps for devflow enforcement, loop behavior, or hook
correctness.

| PR | Status | Reason |
|---|---|---|
| `anomalyco/opencode#16598` | open | Adds `session.stopping`, the closest equivalent to Claude `Stop` hook. Required for `/loop` re-entry parity. |
| `anomalyco/opencode#15412` | open | Adds parent agent context to hook inputs. Required for reliable orchestrator/subagent boundary enforcement and agent telemetry. |
| `anomalyco/opencode#19470` | open | Wires `permission.ask` plugin hook. Allows devflow policy to participate in permission decisions before normal UI prompting. |
| `anomalyco/opencode#22654` | open | Exposes `ask()` inside `tool.execute.before`. Allows pre-tool hooks to request approval instead of only allowing or throwing. |
| `anomalyco/opencode#20053` | open | Allows plugin hooks to mutate tool call args before execution. Needed if the devflow adapter normalizes or rewrites tool arguments. |
| `anomalyco/opencode#21150` | open | Fires `tool.execute.after` after MCP output assembly. Ensures telemetry observes final tool output state. |

#### Should Absorb

These PRs improve lifecycle coverage and plugin reliability. They are not
strictly required for the first blocking hook adapter, but they make the fork
closer to Claude Code/devflow parity.

| PR | Status | Reason |
|---|---|---|
| `anomalyco/opencode#15224` | open | Adds `session.start`, a `SessionStart`-like lifecycle hook for session tracking and startup context. |
| `anomalyco/opencode#23650` | open | Adds `session.turn.completed`, useful for telemetry, phase timing, and future review UI. |
| `anomalyco/opencode#19519` | open | Lets `tool.execute.after` hooks inject AI-visible messages. Useful for post-tool hook feedback. |
| `anomalyco/opencode#21773` | open | Adds `messageID` and `agent` to `shell.env` context. Useful for session-aware subprocess environment injection. |
| `anomalyco/opencode#21776` | open | Adds `bash.commands` timeout exemption hook. Useful if devflow helper CLIs legitimately run longer than normal bash timeouts. |
| `anomalyco/opencode#17517` | open | Awaits plugin event hooks and handles errors in database effects. Stability improvement for hook-dependent integrations. |

#### Rules and Claude Compatibility

These PRs affect how instructions/rules are discovered. They are useful, but
mandatory devflow rule loading must still be explicit through `opencode.json`
`instructions`.

| PR | Status | Recommendation |
|---|---|---|
| `anomalyco/opencode#18903` | open | Absorb if we want native `.opencode/rules/*.{md,mdc}` loading. Small and low-risk. |
| `anomalyco/opencode#10090` | open | Absorb only if we want broader context-aware `.claude/rules/` compatibility. Larger and more ambitious than required for devflow. |
| `anomalyco/opencode#6990` | closed | Use as reference for `.claude/commands/` compatibility. Do not absorb as-is; it includes unresolved `allowed-tools` translation work. |

#### Reference Only

These PRs are useful for design context but should not be absorbed wholesale.

| PR | Status | Reason |
|---|---|---|
| `anomalyco/opencode#11525` | closed | Claims all Claude Code hooks, but describes non-blocking hooks. Devflow requires blocking pre-tool enforcement. Mine for event names and payload ideas only. |
| `anomalyco/opencode#9272` | open | Similar to `session.stopping`, but `#16598` is the better fit for Claude `Stop` parity. Absorb only if it composes cleanly. |
| `anomalyco/opencode#19453` | open | Overlaps with `#19470`. Pick one implementation; prefer `#19470` based on clearer test description. |
| `anomalyco/opencode#20009` | open | Overlaps with `#20053`. Pick one implementation after conflict review; start with `#20053`. |

Recommended fork application order:

1. Apply lifecycle hooks: `#15224`, `#16598`, `#23650`.
2. Apply hook context improvements: `#15412`, `#21773`.
3. Apply permission and tool-hook correctness: `#19470`, `#22654`, `#20053`, `#21150`.
4. Apply optional rule discovery: `#18903` or `#10090`, not both initially unless conflict-free.
5. Evaluate optional stability improvements: `#17517`, `#21776`, `#19519`.

The fork must maintain a compatibility manifest documenting each absorbed PR,
its upstream URL, commit SHA in the fork, and devflow feature that depends on
it. This prevents the fork from becoming an untracked OpenCode distribution.

Earlier high-value upstream PR summary:

| PR | Status | Relevance |
|---|---|---|
| `anomalyco/opencode#16598` | open | Adds `session.stopping`, the closest equivalent to Claude `Stop` loop re-entry. Needed for `/loop` parity. |
| `anomalyco/opencode#15412` | open | Adds parent agent context to hook inputs. Useful for orchestrator/subagent boundary enforcement. |
| `anomalyco/opencode#19470` | open | Wires `permission.ask` plugin hook. Useful for policy-controlled permission decisions. |
| `anomalyco/opencode#22654` | open | Exposes `ask()` inside `tool.execute.before`. Useful for interactive policy decisions. |
| `anomalyco/opencode#20053` | open | Allows plugins to mutate tool call args before execution. Useful for future argument normalization. |
| `anomalyco/opencode#23650` | open | Adds per-turn completion event. Useful for telemetry and review UI, not required for baseline. |
| `anomalyco/opencode#10090` | open | Adds `.claude/rules/` compatibility. Useful but not required because this port explicitly uses `instructions`. |
| `anomalyco/opencode#11525` | closed | Full Claude-style hook proposal. Useful as reference only; not viable as a dependency because it was closed and described non-blocking hooks. |

Initial implementation must not block on these PRs. `/loop` parity should be
tracked as blocked or partial until `session.stopping` or equivalent behavior
exists in a released OpenCode version.

### Telemetry

Existing telemetry scripts hardcode `harness = claude` in several inserts.
They must read `harness` from hook input, defaulting to `claude` for backward
compatibility.

The OpenCode adapter must provide:
- `harness: opencode`
- session ID when available
- agent identity when available
- canonical tool name
- normalized file path or command

### Installer Changes

Update `manifests/install-modules.json`:
- Add OpenCode to skill module targets.
- Add OpenCode to relevant command targets after command conversion exists.
- Add OpenCode-specific plugin adapter module.
- Add OpenCode-specific settings/config module.

Update `scripts/install/install.py`:
- Change default OpenCode root to `~/.config/opencode`.
- Add `--target opencode --project-local` or equivalent for `.opencode/` installs.
- Add content transforms for agents and commands.
- Generate or merge `opencode.json` safely.
- Generate `AGENTS.md` if absent, or install `devflow/AGENTS.md` and reference it
  from `opencode.json` `instructions` if merge safety is a concern.
- Preserve install-state tracking for every generated and copied file.

### Testing Strategy

Installer tests must validate actual OpenCode compatibility, not just file
presence.

Required tests:
- `./install.sh --target claude --root <tmp>` still installs the current Claude
  layout.
- `./install.sh --target opencode --root <tmp>` installs OpenCode layout.
- `OPENCODE_CONFIG_DIR=<tmp> opencode agent list` succeeds.
- Installed OpenCode `opencode.json` contains all mandatory rule files in
  `instructions`.
- Installed OpenCode `AGENTS.md` contains the fail-closed rule-loading contract.
- Every installed OpenCode agent has valid OpenCode frontmatter.
- OpenCode skills are discoverable by path and have valid `SKILL.md`
  frontmatter.
- OpenCode plugin adapter blocks a synthetic disallowed write when a canonical
  hook exits `2`.
- OpenCode plugin adapter does not block when telemetry hooks fail.
- Existing hook shell tests continue to pass unchanged.

## Acceptance Criteria

1. `./install.sh --target opencode --root <tmp>` installs to an OpenCode-valid
   directory structure rooted at the provided root.
2. The default OpenCode global install root is `~/.config/opencode`, not
   `~/.opencode`.
3. The OpenCode install writes or merges `opencode.json` with explicit
   `instructions` entries for every mandatory devflow rule file.
4. The OpenCode install writes an `AGENTS.md` fail-closed rule-loading contract.
5. OpenCode install does not rely on `~/.claude/rules/` compatibility.
6. `OPENCODE_CONFIG_DIR=<tmp> opencode agent list` succeeds after install.
7. All OpenCode-installed agents use valid OpenCode frontmatter and permission
   syntax.
8. Model aliases in canonical agent files do not break OpenCode agent loading.
9. OpenCode installs all devflow skills under `skills/` with valid `SKILL.md`
   frontmatter.
10. OpenCode installs `/flow` as a usable command without unresolved
    `${CLAUDE_PLUGIN_ROOT}` references.
11. Claude install behavior remains unchanged and its existing install tests
    continue to pass.
12. An OpenCode plugin adapter exists and is installed for the OpenCode target.
13. The adapter maps `tool.execute.before` to canonical pre-tool hook execution.
14. The adapter blocks an OpenCode tool call when a canonical pre-tool hook exits
    `2`.
15. The adapter maps `tool.execute.after` to canonical post-tool telemetry hook
    execution.
16. Telemetry records use `harness = opencode` for OpenCode-originated events.
17. Telemetry failures in OpenCode adapter do not block work.
18. The adapter normalizes OpenCode tool names and tool inputs into canonical
    devflow hook JSON.
19. Existing Python hook tests pass without requiring separate OpenCode-specific
    hook implementations.
20. `/loop` support is explicitly documented as partial unless the released
    OpenCode version includes a `session.stopping`-equivalent hook.

## Alternatives Considered

### Rely on `~/.claude/rules/` in OpenCode

Rejected for the initial port. Current OpenCode documentation lists
`CLAUDE.md`, `~/.claude/CLAUDE.md`, and `~/.claude/skills/` compatibility, but
not `~/.claude/rules/`. Upstream PR `#10090` may add this later, but mandatory
rules must not depend on unreleased behavior.

### Duplicate OpenCode-Specific Agents and Commands

Rejected. It would work initially but create drift. The correct approach is
canonical markdown plus target-specific transforms.

### Port Hooks Directly to JavaScript

Rejected for the initial port. It duplicates enforcement logic and increases
the chance Claude and OpenCode diverge. A JS adapter around existing Python
hooks is smaller and keeps behavior shared.

### Wait for Full Claude Hook Compatibility Upstream

Rejected. Baseline `/flow`, rules, agents, skills, and tool enforcement can be
ported using existing OpenCode plugin hooks. Only `/loop` parity should wait
for or contribute to upstream lifecycle hooks.

### Use OpenCode Permissions Only, Without Devflow Hooks

Rejected. OpenCode permissions provide useful coarse controls, but devflow
requires proposal lifecycle checks, TDD commit ordering, artifact sequencing,
and phase-aware enforcement. Those remain devflow hook responsibilities.

## Reset History

This section is populated automatically when a reset occurs.
