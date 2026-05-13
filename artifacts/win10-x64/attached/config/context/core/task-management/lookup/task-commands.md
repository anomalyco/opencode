<!-- Context: core/task-commands | Priority: high | Version: 1.0 | Updated: 2026-02-15 -->

# Lookup: Task CLI Commands

**Purpose**: Quick reference for task-cli.ts commands

**Last Updated**: 2026-02-14

---

## Usage

```bash
npx ts-node /Users/apple/.config/opencode/context/tasks/scripts/task-cli.ts <command> [args]
```

Task files are stored in `.tmp/tasks/` at the project root.

---

## Commands

### status [feature]

Show task status summary for all features or specific feature.

```bash
task-cli.ts status
task-cli.ts status my-feature
```

**Output**:
```
[my-feature] My Feature Name
  Status: active | Progress: 40% (2/5)
  Pending: 2 | In Progress: 1 | Completed: 2 | Blocked: 0
```

---

### next [feature]

Show tasks ready to work on (deps satisfied).

```bash
task-cli.ts next
task-cli.ts next my-feature
```

**Output**:
```
=== Ready Tasks (deps satisfied) ===

[my-feature]
  02 - Create JWT service  [sequential]
  03 - Write unit tests    [parallel]
```

---

### parallel [feature]

Show only parallelizable tasks ready now.

```bash
task-cli.ts parallel
task-cli.ts parallel my-feature
```

**Use**: Batch multiple isolated tasks for parallel execution.

---

### deps \<feature\> \<seq\>

Show dependency tree for a specific task.

```bash
task-cli.ts deps my-feature 04
```

**Output**:
```
=== Dependency Tree: my-feature/04 ===

04 - Integration tests [pending]
  ├── ✓ 01 - Setup database [completed]
  └── ○ 02 - Create API [pending]
      └── ✓ 01 - Setup database [completed]
```

---

### blocked [feature]

Show blocked tasks and reasons.

```bash
task-cli.ts blocked
task-cli.ts blocked my-feature
```

**Output**:
```
=== Blocked Tasks ===

[my-feature]
  04 - Integration tests (waiting: 02, 03)
  05 - Deploy (explicitly blocked)
```

---

### complete \<feature\> \<seq\> "summary"

Mark task as completed with summary (max 200 chars).

```bash
task-cli.ts complete my-feature 02 "Created JWT service with RS256 signing"
```

**Effect**:
- Sets `status: "completed"`
- Sets `completed_at` timestamp
- Sets `completion_summary`
- Updates `task.json` counts

---

### validate [feature]

Check JSON validity, dependencies, circular refs.

```bash
task-cli.ts validate
task-cli.ts validate my-feature
```

**Checks**:
- task.json exists
- ID format correct
- Dependencies exist
- No circular dependencies
- Counts match

**Output**:
```
[my-feature]
  ✓ All checks passed

[broken-feature]
  ✗ ERROR: 03: depends on non-existent task 99
  ⚠ WARNING: 02: No acceptance criteria defined
```

---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Error (validate found issues, missing args) |

---

## Enhanced Schema Support

The CLI fully supports the enhanced task schema (v2.0) with:
- **Line-number precision** - Context files with specific line ranges
- **Domain modeling** - bounded_context, module, vertical_slice fields
- **Contract tracking** - API/interface dependencies
- **Design artifacts** - Figma, wireframes, mockups
- **ADR references** - Architecture decision records
- **Prioritization** - RICE/WSJF scores

All enhanced fields are optional and backward compatible. See `../standards/enhanced-task-schema.md` for details.

---

## Planning Workflow Integration

For multi-stage orchestration workflows, use these planning agents before task creation:

| Agent | Purpose | Output |
|-------|---------|--------|
| **ArchitectureAnalyzer** | DDD bounded context identification | `.tmp/architecture/contexts.json` |
| **StoryMapper** | User journey and story mapping | `.tmp/story-maps/map.json` |
| **PrioritizationEngine** | RICE/WSJF scoring | `.tmp/backlog/prioritized.json` |
| **ContractManager** | API contract definition | `.tmp/contracts/{service}.json` |
| **ADRManager** | Architecture decision records | `docs/adr/` |

These agents populate enhanced schema fields (bounded_context, contracts, related_adrs, rice_score, etc.) automatically.

See `/Users/apple/.config/opencode/context/core/workflows/multi-stage-orchestration.md` for the complete workflow.

---

## Related

- `../standards/task-schema.md` - Base JSON schema reference
- `../standards/enhanced-task-schema.md` - Extended schema with advanced features
- `../guides/managing-tasks.md` - Workflow guide
- `../workflows/multi-stage-orchestration.md` - Planning workflow
