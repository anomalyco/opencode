# Hierarchical Orchestrator

ShopOS uses a 3-tier autonomous agent system for complex task execution.

## Architecture

```
User Prompt
     ↓
┌─────────────────┐
│    PLANNER      │  ← Breaks down intent, spawns workers
└────────┬────────┘
         │ spawns (parallel)
    ┌────┼────┐
    ↓    ↓    ↓
┌──────┐┌──────┐┌──────┐
│WORKER││WORKER││WORKER│  ← Execute work units
└──┬───┘└──┬───┘└──┬───┘
   │       │       │
   ↓       ↓       ↓
@analyst @strategist @executor  ← Domain specialists
         │
         ↓
┌─────────────────┐
│    REVIEWER     │  ← Validates, triggers retries
└─────────────────┘
         │
         ↓
   Complete Output
```

## Agents

| Agent | Purpose | Mode |
|-------|---------|------|
| planner | Orchestration, planning | primary |
| worker | Generic execution | subagent |
| reviewer | Validation | subagent |
| analyst | Data queries | all |
| strategist | Strategy creation | all |
| executor | Space execution | all |

## Usage

Simply give an outcome-oriented request:

```
Launch my new product for Nike
Create a Christmas campaign
Analyze and optimize Q4 performance
```

The system will:
1. Plan the execution
2. Spawn parallel workers
3. Validate outputs
4. Deliver complete results

No manual step-by-step guidance needed.

## Shared Memory

Agents communicate via `.opencode/plan/current.md`:
- Planner creates the plan
- Workers update their unit status
- Reviewer reads final state

## Error Handling

- Workers retry failed operations once
- Reviewer identifies remaining failures
- Planner can spawn additional retry workers
- Users notified only for unrecoverable errors
