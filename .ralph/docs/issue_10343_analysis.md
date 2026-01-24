# Issue #10343: Misleading Tip about location of custom-tools

## Root Cause Analysis

### Problem Statement

A tip in the TUI states: "Add .md files to .opencode/agent/ for specialized AI personas"

However, the actual configuration loader searches for agents in **multiple locations**, not just `.opencode/agent/`. This can mislead users who may think agents can only be placed in that single directory.

### Technical Details

**Tip Location**: `packages/opencode/src/cli/cmd/tui/component/tips.tsx:94`

```typescript
"Add {highlight}.md{/highlight} files to {highlight}.opencode/agent/{/highlight} for specialized AI personas",
```

**Actual Agent Search Paths**: `packages/opencode/src/config/config.ts:300`

```typescript
const patterns = ["/.opencode/agent/", "/.opencode/agents/", "/agent/", "/agents/"]
```

The configuration system searches in **4 different locations**:

1. **`.opencode/agent/`** - Project-specific agents (recommended)
2. **`.opencode/agents/`** - Alternative project-specific location
3. **`agent/`** - Root-level agent directory
4. **`agents/`** - Alternative root-level location

### Why This Matters

Users may:
- Think they can only use `.opencode/agent/`
- Be unaware of the alternative valid locations
- Create directory structures that don't match their workflow
- Miss the fact that plural `agents/` is also valid

### Agent Creation Command Behavior

**File**: `packages/opencode/src/cli/cmd/agent.ts`

When running `opencode agent create`, the system correctly uses multiple paths:

**Lines 78-103**:
```typescript
// Determine scope/path
let targetPath: string
if (cliPath) {
  targetPath = path.join(cliPath, "agent")
} else {
  let scope: "global" | "project" = "global"
  if (project.vcs === "git") {
    const scopeResult = await prompts.select({
      message: "Location",
      options: [
        {
          label: "Current project",
          value: "project" as const,
          hint: Instance.worktree,
        },
        {
          label: "Global",
          value: "global" as const,
          hint: Global.Path.config,
        },
      ],
    })
    if (prompts.isCancel(scopeResult)) throw new UI.CancelledError()
    scope = scopeResult
  }
  targetPath = path.join(
    scope === "global" ? Global.Path.config : path.join(Instance.worktree, ".opencode"),
    "agent",
  )
}
```

The agent creation command:
- Allows **global** agents in `~/.config/opencode/agent/`
- Allows **project** agents in `<project>/.opencode/agent/`
- Always uses singular `agent/` (not `agents/`)

However, the **config loader** accepts both singular and plural forms in multiple locations.

### Solution

**Option 1: Update Tip to Be More Accurate**

**File**: `packages/opencode/src/cli/cmd/tui/component/tips.tsx:94`

**Current**:
```typescript
"Add {highlight}.md{/highlight} files to {highlight}.opencode/agent/{/highlight} for specialized AI personas",
```

**Proposed Change**:
```typescript
"Add {highlight}.md{/highlight} files to {highlight}.opencode/agent/{/highlight} or {highlight}~/.config/opencode/agent/{/highlight} for custom AI personas",
```

This clarifies:
1. Project-specific agents go in `.opencode/agent/`
2. Global agents go in `~/.config/opencode/agent/`

**Option 2: Expand Tip to Show All Options**

```typescript
"Create custom agents in {highlight}.opencode/agent/{/highlight} (project) or {highlight}~/.config/opencode/agent/{/highlight} (global)",
```

**Option 3: Add Additional Tip About Agent Creation**

Add a new tip to the array:
```typescript
"Run {highlight}opencode agent create{/highlight} for guided custom agent creation",
```

This tip already exists on line 116, so users are aware of the command.

### Recommendation

**Option 1** is recommended because it:
- Corrects the misleading information
- Shows both project and global locations
- Doesn't overwhelm with all 4 technical search paths
- Aligns with what the agent creation command actually uses

The other search paths (`/agents/`, `/agent/`) are likely for backward compatibility or edge cases, and users shouldn't be encouraged to use them over the standard locations.

### Related Tips

Other directory-related tips that may need review:

**Line 91**: Custom prompts
```typescript
"Add {highlight}.md{/highlight} files to {highlight}.opencode/command/{/highlight} to define reusable custom prompts",
```

**Line 103**: Custom tools
```typescript
"Create {highlight}.ts{/highlight} files in {highlight}.opencode/tool/{/highlight} to define new LLM tools",
```

**Line 105**: Plugins
```typescript
"Add {highlight}.ts{/highlight} files to {highlight}.opencode/plugin/{/highlight} for event hooks",
```

These should be verified to ensure they accurately reflect the actual search paths used by the configuration loader.

### Testing

No automated test required - this is a documentation string update.

**Manual Testing**:
1. Start `opencode` TUI
2. Observe tips at bottom of screen
3. Verify new tip appears and is accurate
4. Test that both project and global agent locations work

### Impact

**Severity**: LOW - Misleading documentation, but functionality works correctly

**Affected Users**:
- Users reading tips trying to understand where to place custom agents
- Users who might want to use global agents but think only project-local agents are supported

**User Experience**:
- Before: User thinks agents can only go in `.opencode/agent/`
- After: User understands both project and global agent locations

### Status

- ✅ Root cause identified
- ✅ Solution designed
- ⏳ Awaiting write permissions to implement fix
- ⏳ Related tips should be reviewed for consistency

### Related Code

**Agent Configuration Loading**:
- `packages/opencode/src/config/config.ts:300` - Search patterns
- `packages/opencode/src/agent/agent.ts` - Agent definitions
- `packages/opencode/src/cli/cmd/agent.ts:78-103` - Agent creation paths

**Tips System**:
- `packages/opencode/src/cli/cmd/tui/component/tips.tsx` - All tips
