<!--
  Built-in skill. Name and description are registered in code at
  packages/opencode/src/skill/index.ts (see GOAL_SKILL_NAME
  and GOAL_SKILL_DESCRIPTION). The body below becomes the
  skill's content.
-->

**CRITICAL: create_goal / update_goal / get_goal must be called in the main conversation. Subagents (task) write to their own session — goal state is invisible to them. Never delegate goal state management to a subagent.**

---

# Goal — State-Tracked Iteration

## Architecture Rule

```
┌─────────────────────────────────────────────────┐
│  Main Conversation (owns goal state)            │
│  - create_goal() / update_goal() / get_goal()   │
│  - Decide next step                             │
│  - Aggregate results, judge completion           │
│  - CAN launch task() for data gathering          │
├─────────────────────────────────────────────────┤
│  Subagent (task) — stateless worker             │
│  - Search, scrape, fetch data in parallel        │
│  - Return raw results to main conversation       │
│  - MUST NOT call create_goal / update_goal       │
└─────────────────────────────────────────────────┘
```

## Tools

| Tool | Where | Purpose |
|------|-------|---------|
| create_goal(objective) | Main only | Set the goal at start |
| get_goal() | Main only | Check state before each step |
| update_goal(status) | Main only | Mark complete / blocked |
| task(...) | Main only | Parallel data gathering (not state mgmt) |

## Workflow

### Iteration-based tasks (compile -> fix -> compile)

AI does everything directly, no subagents needed:

```
create_goal("Fix all TypeScript errors")
-> run typecheck -> see 5 errors
-> fix error 1 -> fix error 2 -> ...
-> run typecheck -> 0 errors
-> update_goal("complete")
```

### Data-gathering tasks (search 50 sources)

Main conversation manages state, subagents do parallel searches:

```
Step 1: create_goal("Collect E260 prices from 50 sources")

Step 2: Launch parallel tasks
  task("Search E260 price on site A, B, C")
  task("Search E260 price on site D, E, F")
  // ... more parallel tasks

Step 3: Collect results, merge, deduplicate
  -> Main conversation aggregates all task outputs

Step 4: Judge completion
  -> 50 sources covered? -> update_goal("complete")
  -> Not enough? -> launch more tasks, repeat from Step 2
```

### Mixed pattern (common)

Main conversation does the thinking/summarizing; tasks only fetch raw data.

## Completion Criteria

Clear criteria make auto-evaluation possible:

| Type | Example |
|------|---------|
| Tests passing | All tests passing |
| Code change | Complete form validation on registration page |
| Bug fix | Fix all TypeScript type errors |
| File operations | Migrate 5 files from src/old/ to src/new/ |

## Notes

- Cross-turn: call get_goal() at the start of the next conversation to check and continue
- Cancel anytime with /goal clear
- If blocked, call update_goal(status: "blocked") with an explanation
- Subagents CANNOT see or modify goal state — their session ID differs from the main conversation
