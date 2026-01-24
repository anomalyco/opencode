# Issue #10339: [FEATURE] Add visual indicator for subagent status

## Feature Analysis

### Problem Statement

When a subagent is invoked via the Task tool, users cannot easily see:
1. When a subagent is running
2. What the subagent's status is (pending, running, completed, error)
3. Which agent is being executed
4. How long the subagent has been running

### Current Behavior

**Subtask Part**: Exists in the data model but is NOT rendered in the TUI

**File**: `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:1317-1321`

```typescript
const PART_MAPPING = {
  text: TextPart,
  tool: ToolPart,
  reasoning: ReasoningPart,
  // ❌ No entry for "subtask" - it's invisible!
}
```

**Subtask Part Definition**: `packages/opencode/src/session/message-v2.ts:167-180`

```typescript
export const SubtaskPart = PartBase.extend({
  type: z.literal("subtask"),
  prompt: z.string(),
  description: z.string(),
  agent: z.string(),
  model: z
    .object({
      providerID: z.string(),
      modelID: z.string(),
    })
    .optional(),
  command: z.string().optional(),
})
```

### Subtask vs Tool Part

**Tool Part** (already rendered):
- Represents a single tool call (bash, read, write, etc.)
- Has states: pending, running, completed, failed
- Shows execution time, output, errors
- Visual indicator with status icons

**Subtask Part** (NOT rendered):
- Represents an entire agent invocation
- Can contain multiple tool calls internally
- Should show: agent name, status, duration
- Currently invisible in TUI

### User Experience Gap

**Scenario**:
1. User invokes: `@explore Find all TypeScript files`
2. Subtask part is created but NOT displayed
3. User sees nothing until the subagent completes
4. During execution, user may think AI is stuck
5. No way to see what subagent is running

**Similar Features**:
- Tool parts show status indicators
- Reasoning parts can be toggled
- Agent mode is shown in prompt

### Proposed Solution

**Add SubtaskPart to PART_MAPPING with visual status indicator**

**File**: `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`

**Step 1**: Add to PART_MAPPING
```typescript
const PART_MAPPING = {
  text: TextPart,
  tool: ToolPart,
  reasoning: ReasoningPart,
  subtask: SubtaskPart,  // ✅ Add this
}
```

**Step 2**: Create SubtaskPart component
```typescript
function SubtaskPart(props: {
  last: boolean;
  part: MessageV2.SubtaskPart;
  message: AssistantMessage
}) {
  const { theme } = useTheme()

  // Get status from part state if available
  const status = props.part.state?.status || "unknown"

  // Map status to visual indicator
  const getStatusIndicator = () => {
    switch (status) {
      case "pending": return "⏳"
      case "running": return "▶️"
      case "completed": return "✓"
      case "failed": return "✗"
      default: return "○"
    }
  }

  return (
    <box borderStyle="round" border={{ foreground: theme.textMuted }}>
      <text>
        {getStatusIndicator()} Subagent: {props.part.agent}
      </text>
      <Show when={props.part.description}>
        <text style={{ fg: theme.textMuted }}>
          {" "}{props.part.description}
        </text>
      </Show>
    </box>
  )
}
```

### Data Model Enhancements Needed

**Current SubtaskPart** does NOT have a `state` field for tracking status.

**Option 1**: Add state to SubtaskPart
```typescript
export const SubtaskPart = PartBase.extend({
  type: z.literal("subtask"),
  prompt: z.string(),
  description: z.string(),
  agent: z.string(),
  model: z.object({
    providerID: z.string(),
    modelID: z.string(),
  }).optional(),
  command: z.string().optional(),
  // ✅ Add state tracking
  state: z.object({
    status: z.enum(["pending", "running", "completed", "failed"]),
    startTime: z.number().optional(),
    endTime: z.number().optional(),
  }).optional(),
})
```

**Option 2**: Derive state from message/execution context
- Check if subtask has started (created time)
- Check if subtask has completed (child session exists)
- Show "running" if in progress

### Implementation Plan

**Phase 1: Basic Display (MVP)**
1. Add SubtaskPart to PART_MAPPING
2. Create simple component showing:
   - Agent name
   - Description (if available)
   - Basic status (completed/in-progress)

**Phase 2: Enhanced Status**
1. Add state tracking to SubtaskPart
2. Update component to show:
   - Status icon (running ✓, failed ✗, pending ⏳)
   - Execution time
   - Error message if failed

**Phase 3: Interactive Features**
1. Allow expanding subtask to see nested tool calls
2. Show progress indicator for long-running subagents
3. Add ability to cancel running subagent

### Component Design

**Minimal Implementation** (Phase 1):
```typescript
function SubtaskPart(props: {
  last: boolean;
  part: MessageV2.SubtaskPart;
  message: AssistantMessage
}) {
  const { theme } = useTheme()

  return (
    <box
      borderStyle="single"
      border={{ foreground: theme.accent }}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={0}
      paddingBottom={0}
    >
      <text style={{ fg: theme.accent }}>
        ◆ {props.part.agent}
      </text>
      <Show when={props.part.description}>
        <text style={{ fg: theme.textMuted }}>
          : {props.part.description}
        </text>
      </Show>
    </box>
  )
}
```

**Enhanced Implementation** (Phase 2):
```typescript
function SubtaskPart(props: {
  last: boolean;
  part: MessageV2.SubtaskPart;
  message: AssistantMessage
}) {
  const { theme } = useTheme()
  const state = props.part.state

  const getStatusColor = () => {
    switch (state?.status) {
      case "completed": return theme.success
      case "failed": return theme.error
      case "running": return theme.warning
      default: return theme.textMuted
    }
  }

  const getStatusIcon = () => {
    switch (state?.status) {
      case "completed": return "✓"
      case "failed": return "✗"
      case "running": return "▶"
      default: return "○"
    }
  }

  const getDuration = () => {
    if (!state?.startTime) return ""
    const end = state.endTime || Date.now()
    const duration = Math.round((end - state.startTime) / 1000)
    return `${duration}s`
  }

  return (
    <box
      borderStyle="round"
      borderColor={getStatusColor()}
      paddingLeft={1}
      paddingRight={1}
    >
      <text style={{ fg: getStatusColor() }}>
        {getStatusIcon()} {props.part.agent}
      </text>
      <Show when={props.part.description}>
        <text style={{ fg: theme.textMuted }}>
          {" "}{props.part.description}
        </text>
      </Show>
      <text style={{ fg: theme.textMuted }}>
        {" "}{getDuration()}
      </text>
    </box>
  )
}
```

### Visual Design Considerations

**TUI Constraints**:
- Limited space (typically 80-120 characters wide)
- No colors on all terminals
- Need clear status indicators

**Best Practices**:
- Use Unicode symbols for status (✓ ✗ ▶ ⏳)
- Fallback to ASCII symbols if needed (-> X > o)
- Color coding: green (success), red (error), yellow (running)
- Keep descriptions brief (< 50 chars)

**Example Display**:
```
▶ explore: Finding TypeScript files 15s
✓ build: Compiled successfully     3s
✗ test: Unit tests failed          8s
```

### Testing Strategy

**Unit Tests**:
```typescript
test("SubtaskPart renders agent name", () => {
  const part: SubtaskPart = {
    type: "subtask",
    agent: "explore",
    description: "Search for files",
    // ...
  }
  // Verify component renders correctly
})

test("SubtaskPart shows status icon", () => {
  // Test each status: pending, running, completed, failed
})
```

**Manual Testing**:
1. Invoke subagent: `@explore Find all test files`
2. Verify visual indicator appears
3. Wait for completion
4. Verify status changes to completed
5. Test with failing subagent
6. Verify error indicator

### Dependencies

**Related Components**:
- `ToolPart` - Similar pattern for status display
- `ReasoningPart` - Toggle visibility pattern
- Message rendering system

**Related Files**:
- `packages/opencode/src/session/message-v2.ts` - Data model
- `packages/opencode/src/session/prompt.ts` - Subtask creation
- `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` - Rendering

### Alternative Approaches

**Option A**: Inline in message flow (recommended)
- Pros: Clear context, follows existing pattern
- Cons: Takes vertical space

**Option B**: Sidebar indicator
- Pros: Saves space, always visible
- Cons: Requires sidebar changes, more complex

**Option C**: Status bar
- Pros: Minimal space
- Cons: Only shows one at a time, can be missed

**Recommendation**: Start with Option A (inline), consider others for future enhancements.

### Priority

**Severity**: LOW (feature request, not a bug)

**Impact**: Improved UX, better visibility into agent operations

**Effort**: Medium (requires data model changes + new component)

### Status

- ✅ Requirements analyzed
- ✅ Design proposed
- ⏳ Data model changes needed (add state to SubtaskPart)
- ⏳ Component implementation
- ⏳ Testing
- ⏳ Documentation

### Implementation Checklist

1. [ ] Update SubtaskPart schema to include state field
2. [ ] Add SubtaskPart to PART_MAPPING
3. [ ] Implement SubtaskPart component (Phase 1: basic display)
4. [ ] Test with various subagent invocations
5. [ ] Enhance with status tracking (Phase 2)
6. [ ] Add interactive features (Phase 3 - future)
7. [ ] Update documentation
8. [ ] Add tests

### Related Features

This is similar to existing tool part status indicators - should follow the same visual patterns for consistency.

**Files to Modify**:
- `packages/opencode/src/session/message-v2.ts` - Add state to SubtaskPart
- `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` - Add component and mapping
- Potentially: `packages/opencode/src/session/prompt.ts` - Set state when creating subtasks
