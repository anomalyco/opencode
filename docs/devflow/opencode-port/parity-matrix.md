# Claude Code to OpenCode Parity Matrix

Status values: `Not Started`, `Partial`, `Blocked`, `Parity`, `Not Applicable`.

| Area | Claude Code Behavior | OpenCode Target Behavior | Required OpenCode/Fork Support | Current Status | Evidence |
|---|---|---|---|---|---|
| Mandatory rules | Rules installed and loaded through Claude/plugin context | Rules explicitly listed in `opencode.json` `instructions`; fail-closed `AGENTS.md` | None | Not Started | TBD |
| Agents | Markdown agents with Claude `tools` arrays | Markdown agents with OpenCode `permission` objects | None | Not Started | Disposable install currently fails on Claude `tools` array |
| Skills | `skills/<name>/SKILL.md` | Native OpenCode skills | None | Not Started | TBD |
| `/flow` command | Claude command markdown | OpenCode command markdown with converted frontmatter | None | Not Started | TBD |
| `/loop` command | Claude `Stop` hook re-enters loop | OpenCode `session.stopping` injects follow-up message | PR `#16598` | Blocked | TBD |
| Pre-tool edit/write enforcement | Claude `PreToolUse` hook chain blocks exit 2 | OpenCode `tool.execute.before` adapter throws on exit 2 | Existing plugin hook plus adapter | Not Started | TBD |
| Pre-tool bash enforcement | Claude `PreToolUse Bash` hook chain blocks exit 2 | OpenCode `tool.execute.before` adapter throws on exit 2 | Existing plugin hook plus adapter | Not Started | TBD |
| `apply_patch` enforcement | Claude uses `MultiEdit` | Adapter parses OpenCode `apply_patch` patch paths and applies write enforcement | None | Not Started | TBD |
| Post-tool telemetry | Claude `PostToolUse` hooks | OpenCode `tool.execute.after` adapter | PR `#21150` improves MCP timing | Not Started | TBD |
| Session start telemetry | Claude `SessionStart` | OpenCode `session.start` | PR `#15224` | Blocked | TBD |
| Compaction reinforcement | Claude compact matcher reinjects rules | OpenCode compaction plugin hook | Existing `experimental.session.compacting` | Not Started | TBD |
| Subagent start telemetry | Claude `SubagentStart` | OpenCode task/tool/session context | PR `#15412` | Blocked | TBD |
| Subagent stop telemetry | Claude `SubagentStop` | OpenCode child session/task completion event | Needs validation | Not Started | TBD |
| Orchestrator lockdown | Hook blocks main-session write/bash | OpenCode primary agent permissions plus hook adapter | PR `#15412` helps identity | Not Started | TBD |
| Worktree isolation | Hook blocks source writes in main worktree | Same hook via adapter; optional native session cwd support | None initially | Not Started | TBD |
| TDD commit ordering | Bash/write hooks enforce test-before-impl commits | Same Python hook via adapter | None | Not Started | TBD |
| Test-before-commit | Bash hook enforces tests passed after changes | Same Python hook via adapter | None | Not Started | TBD |
| Artifact sequencing | Bash commit hook validates docs/work artifacts | Same Python hook via adapter | None | Not Started | TBD |
| Initiative content checks | Bash commit hook validates artifact content | Same Python hook via adapter | None | Not Started | TBD |
| Criteria coverage gate | Write hooks block under-reviewed implementation | Same Python hook via adapter | None | Not Started | TBD |

## Parity Levels

| Level | Meaning |
|---|---|
| L0 | OpenCode install does not load or rejects config |
| L1 | Rules, agents, skills, and `/flow` load |
| L2 | Blocking pre-tool enforcement works for write/edit/bash |
| L3 | Telemetry and lifecycle hooks work |
| L4 | `/loop` and subagent lifecycle parity work on fork |
| L5 | OpenCode is primary target with Claude compatibility maintained |

Current target milestone: L2 before attempting `/loop` parity.
