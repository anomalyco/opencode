# Issue #10346 & #10344: opentui fatal: undefined is not an object (evaluating 'local.agent.current().name')

## Root Cause Analysis

### Problem Statement
OpenCode TUI (opentui) crashes with fatal error: "undefined is not an object (evaluating 'local.agent.current().name')"

**Note**: This issue appears twice in the fix plan (#10346 and #10344), indicating it's a recurring problem affecting multiple users.

### Technical Details

**File**: `/root/opencode/packages/opencode/src/cli/cmd/tui/context/local.tsx`

**Root Cause**: Unsafe array access without null checks

**Location 1 - Line 41** (Initialization):
```typescript
const agent = iife(() => {
  const agents = createMemo(() => sync.data.agent.filter((x) => x.mode !== "subagent" && !x.hidden))
  const [agentStore, setAgentStore] = createStore<{
    current: string
  }>({
    current: agents()[0].name,  // ❌ BUG: Assumes agents()[0] exists
  })
```

**Location 2 - Lines 56-58** (current() method):
```typescript
current() {
  return agents().find((x) => x.name === agentStore.current)!  // ❌ BUG: Assumes find always succeeds
}
```

### Why This Happens

The error occurs when:
1. **No agents available**: The `agents()` filtered array is empty
2. **All agents filtered out**: All agents are either `mode: "subagent"` or `hidden: true`
3. **Agents not loaded yet**: `sync.data.agent` is empty during initialization

### Reproduction Scenarios

**Scenario 1**: Custom configuration disables all native agents
```json
// opencode.json
{
  "agent": {
    "build": { "disable": true },
    "plan": { "disable": true }
  }
}
```
Result: No agents available → `agents()[0]` is `undefined` → Crash

**Scenario 2**: Timing issue during initialization
- Agents list loads asynchronously
- UI renders before agents are available
- `current()` called before agents array populated

**Scenario 3**: Agent filtering bug
- If filter logic is too restrictive
- Or if agent data is corrupted

### Impact

**Severity**: HIGH - Application crash, complete TUI failure

**Affected Users**:
- Anyone with custom agent configuration
- Users during initialization
- Anyone who accidentally disables all agents

**Error Message**: "undefined is not an object (evaluating 'local.agent.current().name')"

### Solution

**Fix Location**: `local.tsx:36-86` (agent initialization)

**Option 1: Add Null Safety (Recommended)**

```typescript
const agent = iife(() => {
  const agents = createMemo(() => sync.data.agent.filter((x) => x.mode !== "subagent" && !x.hidden))
  const firstAgent = agents()[0]
  const [agentStore, setAgentStore] = createStore<{
    current: string
  }>({
    current: firstAgent?.name ?? "build",  // ✅ Safe access with fallback
  })

  // ... rest of code

  return {
    list() {
      return agents()
    },
    current() {
      const current = agents().find((x) => x.name === agentStore.current)
      // ✅ Return first available agent if current not found
      return current ?? agents()[0] ?? createFallbackAgent()
    },
    // ... rest of methods
  }
})

// Helper function to create fallback agent
function createFallbackAgent() {
  return {
    name: "build",
    mode: "primary" as const,
    native: true,
    permission: PermissionNext.fromConfig({ "*": "ask" }),
    description: "Default agent",
  }
}
```

**Option 2: Validate and Error Gracefully**

```typescript
const agent = iife(() => {
  const agents = createMemo(() => sync.data.agent.filter((x) => x.mode !== "subagent" && !x.hidden))

  // Validate that at least one agent exists
  if (agents().length === 0) {
    throw new Error(
      "No agents available. Please ensure at least one agent is enabled in your configuration.\n" +
      "Visit https://opencode.ai/docs/agents for more information."
    )
  }

  const [agentStore, setAgentStore] = createStore<{
    current: string
  }>({
    current: agents()[0].name,
  })
  // ... rest of code
})
```

**Option 3: Lazy Initialization with Default**

```typescript
const agent = iife(() => {
  const agents = createMemo(() => {
    const filtered = sync.data.agent.filter((x) => x.mode !== "subagent" && !x.hidden)
    // Ensure at least "build" agent is available
    return filtered.length > 0 ? filtered : getDefaultAgents()
  })

  const [agentStore, setAgentStore] = createStore<{
    current: string
  }>({
    current: agents()[0]?.name ?? "build",
  })
  // ... rest of code
})

function getDefaultAgents() {
  // Return minimal default agent configuration
  return [{
    name: "build",
    mode: "primary",
    native: true,
    // ... minimal config
  }]
}
```

### Recommended Fix Strategy

**Immediate** (Option 1):
- Add null-safe access with `?.` operator
- Provide sensible fallbacks
- Prevent crash but log warning when fallback used

**Follow-up**:
- Add validation on startup
- Show user-friendly error if no agents available
- Add tests for empty agent list scenario

### Testing

Add test case to `local.test.tsx`:

```typescript
test("handles empty agent list gracefully", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        build: { disable: true },
        plan: { disable: true },
      },
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const local = useLocal()
      const agents = local.agent.list()

      // Should not crash
      expect(() => local.agent.current()).not.toThrow()

      // Should return fallback or handle gracefully
      const current = local.agent.current()
      expect(current).toBeDefined()
    },
  })
})
```

### Related Code

Similar pattern may exist in:
- Model selection (same file, lines 88-100)
- Other contexts that access `sync.data.agent` array

### Code Locations Using `local.agent.current()`

Found in these files:
1. `/root/opencode/packages/opencode/src/cli/cmd/tui/component/dialog-agent.tsx:??` - `current={local.agent.current().name}`
2. `/root/opencode/packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx:??` - Multiple uses

All these locations would fail if `local.agent.current()` returns `undefined`.

### User Impact

**Before Fix**:
- Application crashes completely
- User cannot use OpenCode TUI
- No error recovery possible

**After Fix**:
- Graceful degradation
- Fallback to default agent
- Clear error messages if configuration is invalid

### Status

- ✅ Root cause identified
- ✅ Unsafe array access pattern found
- ✅ Multiple fix options designed
- ⏳ Awaiting write permissions to implement fix
- ⏳ Tests to be written

### Prevention

**Code Review Checklist**:
- [ ] Always validate array access before `[0]`
- [ ] Use optional chaining `?.` for potentially undefined values
- [ ] Provide fallbacks for critical data
- [ ] Add tests for empty array scenarios

**Related Issues**:
- This pattern may exist elsewhere in the codebase
- Recommend audit of all array access patterns
