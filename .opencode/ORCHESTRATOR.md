# Hierarchical Orchestrator

ShopOS uses a 3-tier autonomous agent system for complex task execution.

## Architecture

```
User Prompt
     ↓
┌─────────────────┐
│    PLANNER      │  ← Researches & Creates DAG Plan
└────────┬────────┘
         │ spawns (research only)
    ┌────┴────┐
    ↓         ↓
┌──────┐   ┌──────┐
│WORKER│   │WORKER│  ← Execute Research
└──┬───┘   └──┬───┘
   │          │
   ↓          ↓
@analyst   @strategist
   │          │
   └─────┬────┘
         ↓
    DAG Plan Output
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
1. Research the user request (using @analyst/@strategist)
2. Create a detailed execution plan (DAG of Spaces)
3. Present the plan for user approval (Stop)

It DOES NOT execute the plan automatically.

No manual step-by-step guidance needed.

## Shared Memory

Agents communicate via files in `.opencode/plan/<goal>/`:
- Planner creates `plan.json` (DAG) and `plan.md` (Summary)
- Research workers write reports to this folder
- No execution status is tracked (as execution is deferred)

## Error Handling

- Workers retry failed operations once
- Reviewer identifies remaining failures
- Planner can spawn additional retry workers
- Users notified only for unrecoverable errors
