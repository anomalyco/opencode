<!-- Context: openagents-repo/lookup | Priority: high | Version: 1.0 | Updated: 2026-02-15 -->

# Lookup: Subagent Framework Maps

**Purpose**: Quick reference for adding subagents to eval framework  
**Last Updated**: 2026-01-09

---

## Critical: THREE Maps Must Be Updated

When adding a new subagent, update these THREE locations:

### 1. Parent Map (run-sdk-tests.ts ~line 336)
**Purpose**: Maps subagent → parent agent for delegation testing

```typescript
const subagentParentMap: Record<string, string> = {
  'contextscout': 'openagent',     // Core subagents → openagent
  'task-manager': 'openagent',
  'documentation': 'openagent',
  
  'coder-agent': 'opencoder',      // Code subagents → opencoder
  'tester': 'opencoder',
  'reviewer': 'opencoder',
};
```

### 2. Path Map (run-sdk-tests.ts ~line 414)
**Purpose**: Maps subagent name → file path for test discovery

```typescript
const subagentPathMap: Record<string, string> = {
  'contextscout': 'ContextScout',
  'task-manager': 'TaskManager',
  'coder-agent': 'CoderAgent',
};
```

### 3. Agent Map (test-runner.ts ~line 238)
**Purpose**: Maps subagent name → agent file for eval-runner

```typescript
const agentMap: Record<string, string> = {
  'contextscout': 'ContextScout.md',
  'task-manager': 'TaskManager.md',
  'coder-agent': 'CoderAgent.md',
};
```

---

## Error Messages

| Error | Missing From | Fix |
|-------|--------------|-----|
| "No test files found" | Path Map (#2) | Add to `subagentPathMap` |
| "Unknown subagent" | Parent Map (#1) | Add to `subagentParentMap` |
| "Agent file not found" | Agent Map (#3) | Add to `agentMap` |

---

## Testing Commands

```bash
# Standalone mode (forces mode: primary)
npm run eval:sdk -- --subagent=contextscout

# Delegation mode (tests via parent)
npm run eval:sdk -- --subagent=contextscout --delegate
```

---

## Related

- `guides/testing-subagents.md` - Full testing guide
- `guides/adding-agent.md` - Creating new agents
