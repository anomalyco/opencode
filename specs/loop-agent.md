# Loop Agent — Autonomous Phased Development

## Problem

LLMs lose context in large tasks. A refactoring that touches 10 files across 5 modules inevitably degrades in quality as the conversation grows — the model forgets earlier decisions, mixes up dependencies, and produces inconsistent code. Existing agents (Claude Code, Aider, raw build agent) handle this poorly because they keep everything in a single session with no structure.

The loop agent addresses this by borrowing from software engineering practice: **decompose, delegate, verify, reconcile**.

## Solution

A new built-in agent (`Tab` key → `loop`) that:

1. **Plans** — analyzes the codebase, produces a phased plan with interface contracts between phases
2. **Executes** — delegates each phase to a fresh sub-agent with minimal context (only the scope spec + contracts from prior phases)
3. **Verifies** — runs lint, typecheck, and tests after every phase before moving on
4. **Reconciles** — integration-tests the final result across all phases

Each phase is a narrow, focused unit — 1–5 files, completable in a single sub-agent session. The orchestrator session stays lean: only plans, summaries, and tool calls. The bulk of the work happens in isolated sub-agent sessions that start cold and receive exactly what they need.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    LLM (Loop Orchestrator)                   │
│  System prompt: loop.txt                                     │
│  "Break task into phases, delegate, verify, reconcile"       │
└──────────┬──────────────────────────────────────┬────────────┘
           │ tool calls                            │ tool results
           ▼                                       ▲
┌──────────────────────┐   ┌──────────────────────────────┐
│   Tool Registry      │   │  LoopState (InstanceState)   │
│  ┌─────────────────┐ │   │  plan: Plan | null           │
│  │ loop_plan_create │ │   │  phases: Phase[]            │
│  │ loop_phase_def.  │ │   │  status: idle|running|...   │
│  │ loop_verify_q.   │ │──▶│  completedPhases: number    │
│  │ loop_summary     │ │   │  failedPhases: number       │
│  │ loop_complete    │ │   └──────────────────────────────┘
│  └─────────────────┘ │   ┌──────────────────────────────┐
└──────────────────────┘   │ LoopOrchestrator (Service)   │
                            │  start / startPhase          │
                            │  recordToolCall / isStuck    │
                            │  metrics / reset             │
                            │  isTimedOut / isPhaseTimedOut│
                            └──────────────────────────────┘
```

### Two Services

**`LoopState`** (`@opencode/LoopState`) — the data. Stores the plan, phases, and status in an `InstanceState`-backed `Ref`. Four methods: `get`, `set`, `update`, `reset`.

**`LoopOrchestrator`** (`@opencode/LoopOrchestrator`) — the behavior. Manages timeouts (`GLOBAL_TIMEOUT_MS = 30min`, `PHASE_TIMEOUT_MS = 10min`), stuck detection (3 identical tool calls → `StuckDetectedError`), and progress metrics. Uses `Clock.currentTimeMillis` for testability.

### Five Tools

All scoped to the loop agent (filtered by `registry.ts` when `agent.name === "loop"`):

| Tool | Tool ID | Purpose |
|---|---|---|
| `loop-plan-create.ts` | `loop_plan_create` | Create a phased plan with acceptance criteria |
| `loop-phase-define.ts` | `loop_phase_define` | Update phase scope, criteria, or contract |
| `loop-verify-quality.ts` | `loop_verify_quality` | Run lint/typecheck/test checks on a phase |
| `loop-summary.ts` | `loop_summary` | Generate progress report |
| `loop-complete.ts` | `loop_complete` | Finalize and reset state |

### Quality Checks

`loop_verify_quality` runs real commands via `ChildProcessSpawner`:

| Check | Command | Fallback |
|---|---|---|
| `lint` | `bun run lint` (60s timeout) | Pass if script missing |
| `typecheck` | `bun run typecheck` (60s timeout) | Pass if script missing |
| `test` | `bun test --bail 1` (5min timeout) | Pass if no `scripts.test` |
| `contract` | Validates `interfaceContract` field | Always passes |
| `scope` | Reports phase scope text | Always passes |

### System Prompt (`loop.txt`)

The loop agent's system prompt defines a 6-step workflow:

1. **Analyze** — explore the codebase via sub-agent
2. **Plan** — create a phased plan with `loop_plan_create`
3. **Execute** — delegate each phase via `task` tool
4. **Quality Gate** — run `loop_verify_quality`
5. **Reconcile** — integration-test across phases
6. **Complete** — `loop_summary` + `loop_complete`

Key constraints enforced by the prompt:
- DO NOT modify files directly — always delegate to sub-agents
- DO NOT reference files from future phases
- Keep orchestrator context lean — only plans and summaries
- If a phase fails twice, escalate to the user

## Files

```
packages/opencode/src/tool/
├── loop-state.ts              # Service: plan/phase data
├── loop-orchestrator.ts       # Service: timeouts, stuck, metrics
├── loop-plan-create.ts        # Tool
├── loop-phase-define.ts       # Tool
├── loop-verify-quality.ts     # Tool (quality gate)
├── loop-summary.ts            # Tool
├── loop-complete.ts           # Tool
├── registry.ts                # +3 lines (tool IDs + LayerNode)

packages/opencode/src/agent/prompt/
└── loop.txt                   # System prompt

packages/opencode/test/tool/
├── loop.test.ts               # 25 unit + integration tests
└── loop-e2e.test.ts           # 1 end-to-end test
```

## Tests — 26 passing

| Scope | Tests |
|---|---|
| `plan_create` | creation, duplicate, empty, 10-phase limit, duplicate IDs |
| `phase_define` | no plan, update, nonexistent phase |
| `verify_quality` | no plan, pass, contract flag, advances index |
| `loop_summary` | idle, progress, 100% |
| `loop_complete` | no loop, success, partial, reset |
| Stuck detection | 3 calls, different calls, per-phase isolation, metrics, reset |
| Full cycle | plan → define → verify → summary → complete |
| E2E | ToolRegistry → Agent("loop") → init tools → execute → assert final state |

## Comparison

| Aspect | Build Agent | Loop Agent |
|---|---|---|
| Session length | Single, grows unbounded | Phases: orchestrator stays lean |
| Context cost | Full history per turn | Sub-agents get only scope + contracts |
| Quality gate | None | lint + typecheck + test per phase |
| Error recovery | Manual restart or fix | Auto-retry (1x), then escalate |
| State management | Implicit in conversation | Explicit via LoopState + LoopOrchestrator |
| Testability | Low (no state separation) | High (services, InstanceState, Clock) |

## Future Work

- [ ] Durable loop events via EventV2 (for observability and replay)
- [ ] Configurable timeouts via project's `opencode.json`
- [ ] Better stuck detection (hash tool arguments, not just names)
- [ ] Phase failure telemetry (which checks fail most often)
- [ ] Integration with `SessionV2` runner's bounded loop infrastructure

## PR Checklist

- [x] 26 tests passing
- [x] Typecheck clean
- [x] No `any` types
- [x] No comments (AGENTS.md compliance)
- [x] `Effect.fn` for all service methods
- [x] `Schema.TaggedErrorClass` for errors
- [x] `InstanceState` + `Ref` for mutable state
- [x] `LayerNode` wiring
- [x] Self-reexports
- [x] Consistent naming (`loop_` prefix on all tool IDs)
- [x] `ChildProcessSpawner` for process execution
