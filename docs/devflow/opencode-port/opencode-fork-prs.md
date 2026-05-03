# OpenCode Fork PR Tracker

This file tracks every upstream OpenCode PR absorbed into the devflow OpenCode
fork. Do not apply or retain a fork patch unless it has an entry here.

## Fork Branches

| Branch | Purpose | Current SHA | Last Updated |
|---|---|---:|---|
| `upstream-dev` | Mirror of `anomalyco/opencode:dev` | `387220f368ca3a31d94b4be3937d9d825ebd888c` | 2026-05-03 |
| `devflow/base` | Rebase base for devflow patch stack | `387220f368ca3a31d94b4be3937d9d825ebd888c` | 2026-05-03 |
| `devflow/hojo` | Curated compatibility patch stack | `387220f368ca3a31d94b4be3937d9d825ebd888c` | 2026-05-03 |
| `devflow/release` | Tested branch consumed by devflow users | TBD | TBD |

Local clone: `/Users/jvanzyl/js/jopen/hojo-opencode`.

Remote state: cloned from `https://github.com/anomalyco/opencode`. No
`jvanzyl/opencode` GitHub fork existed when this tracker was initialized.
Before pushing devflow branches, create or choose a fork remote explicitly.

## Required PRs

| PR | Title | Upstream State | Upstream Head | Fork Branch | Fork Commit | Devflow Gap Closed | Risk | Drop When | Status |
|---|---|---|---|---|---|---|---|---|---|
| `#16598` | `feat: add session.stopping hook for plugins` | OPEN | `e19f58e5458a9cdf91645c0adb6827b438af1329` | `devflow/pr-16598-session-stopping` | `e19f58e5458a9cdf91645c0adb6827b438af1329` | `/loop` continuation / Claude `Stop` parity | Medium: loop re-entry can create infinite loops if plugin state is wrong | Upstream merges and rebase includes it | Tested |
| `#15412` | `feat(plugin): include parent agent context in hook inputs` | OPEN | `0b389890a6d3c8f0dc5aceb9a5427def1f2934fb` | `devflow/pr-15412-parent-agent-context` | `0b389890a6d3c8f0dc5aceb9a5427def1f2934fb` | Agent identity and parent-agent context for boundary enforcement | Medium: hook payload shape conflicts possible | Upstream merges and rebase includes it | Tested |
| `#19470` | `feat(opencode): wire permission.ask plugin hook` | OPEN | `e115ed5ef6171f193e83441469631107f901e666` | `devflow/pr-19470-permission-ask` | `e115ed5ef6171f193e83441469631107f901e666` | Plugin participation in permission decisions | Medium: permission flow is security-sensitive | Upstream merges and rebase includes it | Failing Tests |
| `#22654` | `feat(plugin): expose ask() on tool.execute.before hook` | OPEN | `d6b78a2fa9d1d5c77c3419686057a7767cca151f` | TBD | TBD | Interactive pre-tool enforcement path | Medium: depends on permission API shape | Upstream merges and rebase includes it | Not Applied |
| `#20053` | `fix: Allow plugin hooks to mutate tool call args before context creation` | OPEN | `9803c23bdbce96aa25d822451a320e508f32a14b` | TBD | TBD | Argument normalization before execution | High: touches tool execution path | Upstream merges and rebase includes it | Not Applied |
| `#21150` | `fix(session): fire tool.execute.after hook after MCP output assembly` | OPEN | `5ed52021b4ba8e3358aeb315915230995e26e682` | TBD | TBD | Accurate post-tool telemetry | Low/Medium: timing-sensitive | Upstream merges and rebase includes it | Not Applied |

## Strong Candidates

| PR | Title | Upstream State | Upstream Head | Fork Branch | Fork Commit | Devflow Gap Closed | Risk | Decision | Status |
|---|---|---|---|---|---|---|---|---|---|
| `#15224` | `feat(plugin): add session.start hook for session initialization` | OPEN | `d71089b5c41cd86369a11874b7c37a4856acd1a4` | `devflow/pr-15224-session-start` | `d71089b5c41cd86369a11874b7c37a4856acd1a4` | SessionStart-like event | Low/Medium | Absorb unless conflicts are severe | Tested |
| `#23650` | `feat: add session.turn.completed bus event for plugin hooks` | OPEN | `4c644353f4d350672b1f86b2718cbbf04730a145` | `devflow/pr-23650-turn-completed` | `4c644353f4d350672b1f86b2718cbbf04730a145` | Per-turn telemetry and future review UX | Low | Absorb after lifecycle hooks | Tested |
| `#19519` | `feat: allow tool.execute.after hooks to inject AI-visible messages` | OPEN | `4e19d1474fd793e1e79876e16e9a5cc84fdd9b24` | TBD | TBD | Hook feedback visible to agent | Medium | Defer until core adapter works | Not Applied |
| `#21773` | `feat(bash): expand shell.env hook context with messageID and agent` | OPEN | `ded5a9bb03096d07e56c6c45b2305b5c58aba3dc` | TBD | TBD | Session/agent-aware hook subprocess env | Low | Absorb with context improvements | Not Applied |
| `#21776` | `feat(plugin): bash.commands hook for CLI command timeout exemption` | OPEN | `581e483d67f25649335914f80685429e88efeb9b` | TBD | TBD | Long-running devflow helper CLI support | Low | Defer until needed | Not Applied |
| `#17517` | `fix: await plugin event hooks and handle errors in database effects` | OPEN | `7afb805f5bc121699282fcacc9658d4f6b802067` | TBD | TBD | Plugin reliability | Medium | Absorb if clean | Not Applied |

## Rules Compatibility Candidates

| PR | Title | Upstream State | Upstream Head | Fork Branch | Fork Commit | Devflow Gap Closed | Decision | Status |
|---|---|---|---|---|---|---|---|---|
| `#18903` | `feat(instructions): load .opencode/rules/*.{md,mdc}` | OPEN | `d45d0a27b37138039ace946b8be33882791374fd` | TBD | TBD | Native `.opencode/rules` loading | Prefer small rules loader if needed | Not Applied |
| `#10090` | `feat(smart-rules): add context-aware rule injection system with Claude Code compatibility` | OPEN | `1c59cfc3a7a3f5bade7fe368aae0853d8a34aae2` | TBD | TBD | Context-aware `.claude/rules` compatibility | Evaluate after baseline; do not depend on it | Not Applied |

## Reference Only

| PR | Title | Reason Not Absorbed |
|---|---|---|
| `#11525` | `feat: Add complete native hook system with all 12 Claude Code hooks` | Closed, non-blocking hooks. Devflow needs blocking enforcement. |
| `#9272` | `feat(hook): session.before.idle` | Similar to `#16598`; only absorb if it composes cleanly. |
| `#19453` | `fix(opencode): add permission.ask plugin hook back` | Overlaps with `#19470`; choose one. |
| `#20009` | `fix(opencode): allow tool hooks to replace call arguments` | Overlaps with `#20053`; choose one after review. |
| `#6990` | `feat: add .claude/commands/ compatibility for command discovery` | Closed and includes unresolved `allowed-tools` translation work. Use as reference only. |

## Monitoring Command

For each tracked PR:

```bash
gh pr view <number> --repo anomalyco/opencode --json number,state,mergedAt,closedAt,headRefOid,title,url
```

Update this file whenever upstream state or head SHA changes.
