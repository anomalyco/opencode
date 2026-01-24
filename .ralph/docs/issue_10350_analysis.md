# Issue #10350: Under ulw operation, the agent cannot be invoked

## Root Cause Analysis

### Problem Statement
When a user creates a custom agent (or overrides an existing agent) with `mode: "primary"`, that agent cannot be invoked as a subagent via the Task tool. The error message is confusing and doesn't explain the actual problem.

### Technical Details

**File**: `packages/opencode/src/tool/task.ts`

**Current Behavior** (line 24):
```typescript
const agents = await Agent.list().then((x) => x.filter((a) => a.mode !== "primary"))
```

The Task tool filters out ALL primary agents from its list of available subagents. This is intentional - primary agents (build, plan) are designed to be user-facing only, not invoked programmatically.

However, when someone tries to invoke a primary agent anyway (line 57-58):
```typescript
const agent = await Agent.get(params.subagent_type)
if (!agent) throw new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`)
```

The error says "Unknown agent type", which is misleading. The agent exists, it just can't be invoked as a subagent.

### Agent Modes

1. **`"primary"`** - Main user-facing agents (build, plan, compaction, title, summary)
   - Designed for direct user interaction
   - Cannot be invoked as subagents via Task tool
   - Have special permissions and capabilities

2. **`"subagent"`** - Designed for programmatic invocation (general, explore)
   - Can be invoked via Task tool
   - Have restricted permissions (no todo tools, etc.)

3. **`"all"`** - Can act as both primary AND subagent
   - Default mode for custom agents
   - Can be invoked via Task tool
   - Can be set as default agent

### Reproduction Steps

1. Create a custom agent with `mode: "primary"` in opencode.json:
```json
{
  "agent": {
    "ulw": {
      "description": "My custom agent",
      "mode": "primary"
    }
  }
}
```

2. Try to invoke it via the Task tool from another agent

3. Result: Either it doesn't appear in the agent list, or you get a confusing "Unknown agent type" error

### Solution

**Fix Location**: `packages/opencode/src/tool/task.ts:57-58`

**Proposed Change**:
```typescript
const agent = await Agent.get(params.subagent_type)
if (!agent) throw new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`)

// Primary agents cannot be invoked as subagents
if (agent.mode === "primary") {
  throw new Error(
    `Agent "${params.subagent_type}" is a primary agent and cannot be invoked as a subagent. ` +
      `Primary agents (build, plan, etc.) are designed to be user-facing only. ` +
      `If you want to invoke this agent programmatically, change its mode to "all" or "subagent" in your configuration.`
  )
}
```

### User Workaround

If you need to invoke a custom agent programmatically:

**Option 1**: Set mode to `"all"` (recommended for custom agents):
```json
{
  "agent": {
    "ulw": {
      "description": "My custom agent",
      "mode": "all"
    }
  }
}
```

**Option 2**: Set mode to `"subagent"` (if it should only be invoked programmatically):
```json
{
  "agent": {
    "ulw": {
      "description": "My custom agent",
      "mode": "subagent"
    }
  }
}
```

### Testing

Add test case to `packages/opencode/test/tool/task.test.ts`:

```typescript
test("throws helpful error when trying to invoke primary agent", async () => {
  await using tmp = await tmpdir({
    config: {
      agent: {
        my_primary: {
          mode: "primary",
          description: "A primary agent",
        },
      },
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const taskTool = await TaskTool.create({
        agent: undefined,
        sessionID: "test-session",
        messageID: "test-message",
        abort: new AbortController().signal,
      })

      await expect(
        taskTool.execute({
          description: "Test task",
          prompt: "Do something",
          subagent_type: "my_primary",
        })
      ).rejects.toThrow(/primary agent.*cannot be invoked as a subagent/)
    },
  })
})
```

### Related Issues

- Issue #10350: Under ulw operation, the agent cannot be invoked
- Likely affects users who configure custom agents with incorrect mode

### Documentation Updates

Should update:
1. Agent configuration documentation to explain the three modes
2. Task tool documentation to clarify agent mode restrictions
3. Error messages to guide users to correct configuration

### Status

- ✅ Root cause identified
- ✅ Solution designed
- ⏳ Awaiting write permissions to implement fix
- ⏳ Tests to be written
- ⏳ Documentation to be updated
