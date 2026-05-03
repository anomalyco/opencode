# OpenCode Port Gap Log

This file records every known gap between current Claude Code devflow behavior
and OpenCode behavior. Do not close a gap without evidence.

| ID | Gap | Severity | Source | Closing Work | Upstream PR | Status | Evidence |
|---|---|---|---|---|---|---|---|
| G1 | OpenCode install rejects Claude-style agent `tools` array | P0 | Disposable `OPENCODE_CONFIG_DIR` install test | Agent frontmatter transform | None | Open | TBD |
| G2 | Mandatory rules are not guaranteed through `~/.claude/rules/` | P0 | OpenCode docs | `opencode.json` `instructions` plus `AGENTS.md` | Optional `#18903`/`#10090` | Open | TBD |
| G3 | OpenCode target currently installs only rules and agents | P0 | `manifests/install-modules.json` | Add skills, commands, plugin adapter, config modules | None | Open | TBD |
| G4 | Claude `hooks/hooks.json` is not consumed by OpenCode | P0 | OpenCode plugin model | Build JS/TS adapter that invokes canonical Python hooks | None | Open | TBD |
| G5 | `/loop` depends on Claude `Stop` hook | P1 | `hooks/stop-hook.sh` | Use OpenCode `session.stopping` | `#16598` | Partial | `session.stopping` integrated on `devflow/hojo`; `bun test test/plugin/session-stopping.test.ts`, plugin typecheck, and opencode typecheck pass. Gap remains open until `/loop` command/config adapter uses it. |
| G6 | Telemetry scripts must record `harness=opencode` | P1 | Current telemetry behavior | Pass harness through adapter and telemetry scripts | None | Open | TBD |
| G7 | OpenCode `apply_patch` has no Claude `MultiEdit` equivalent payload | P1 | OpenCode tool model | Parse patch paths in adapter | None | Open | TBD |
| G8 | Subagent identity/parent context is insufficient for policy | P1 | Hook payload needs | Absorb parent agent context PR | `#15412` | Partial | `#15412` integrated on `devflow/hojo`; `bun test test/plugin/parent-agent.test.ts`, plugin typecheck, and opencode typecheck pass. Gap remains open until the devflow adapter consumes the context. |
| G9 | SessionStart parity is missing for startup telemetry/context | P2 | Hook lifecycle gap | Absorb session.start PR | `#15224` | Open | TBD |
| G10 | Post-tool hook timing for MCP/plugin tools may miss final output | P2 | Hook timing gap | Absorb after-MCP PR | `#21150` | Open | TBD |

## Gap Closure Requirements

A gap is closed only when all are true:
- The implementation or fork PR is applied.
- A test or manual verification command proves the behavior.
- `parity-matrix.md` is updated.
- `verification-log.md` records the evidence.
