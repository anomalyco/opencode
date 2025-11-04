# Agent Tracking System - Technical Details

## Problem Solved

The orchestrator was failing because:

1. Tools were not properly disabled (config override bug)
2. No way to track which agent was actually executing
3. UI couldn't display agent hierarchy

## Solution: Automatic Agent Tracking

### How It Works

**Every time an assistant message is created**, the system automatically updates the session's orchestration state:

```typescript
// In createMessage() - src/session/prompt.ts line 1002-1017
await Session.update(input.sessionID, (draft) => {
  if (!draft.orchestration) {
    // First message: initialize both root and current
    draft.orchestration = {
      depth: 0,
      status: "active",
      rootAgent: input.agent, // ← Set once
      currentAgent: input.agent, // ← Updated every message
    }
  } else {
    // Subsequent messages: preserve root, update current
    if (!draft.orchestration.rootAgent) {
      draft.orchestration.rootAgent = input.agent
    }
    draft.orchestration.currentAgent = input.agent // ← Always reflects actual agent
  }
})
```

### Key Points

1. **rootAgent**: Set once on first message, NEVER changes
2. **currentAgent**: Updated EVERY message to reflect actual executing agent
3. **Automatic**: No manual tracking needed, happens transparently
4. **Accurate**: Always shows which agent generated which response

### Why This Approach?

**Considered alternatives**:

- ❌ Track only on session start → Doesn't handle mode switches
- ❌ Track only in switch_mode tool → Misses task delegations, resumptions
- ✅ Track on every message → Guaranteed accurate, works in all scenarios

**Scenarios covered**:

- Initial session start with orchestrator
- Explicit mode switch via `switch_mode` tool
- Task delegation via `task` tool (creates child session)
- Resuming from child task (parent resumes with original agent)
- Multiple switches in single session

## Data Flow

### Scenario 1: Normal Session

```
User starts with orchestrator
  ↓
First assistant message created
  ↓
Orchestration state: { rootAgent: "orchestrator", currentAgent: "orchestrator" }
  ↓
Every subsequent message updates currentAgent automatically
```

### Scenario 2: Mode Switch

```
Session with orchestrator
  ↓
orchestrator uses switch_mode → "architect"
  ↓
Next assistant message created with agent="architect"
  ↓
Orchestration state: { rootAgent: "orchestrator", currentAgent: "architect" }
  ↓
architect uses switch_mode → "orchestrator"
  ↓
Next assistant message created with agent="orchestrator"
  ↓
Orchestration state: { rootAgent: "orchestrator", currentAgent: "orchestrator" }
```

### Scenario 3: Task Delegation

```
Parent session (orchestrator)
  ↓
orchestrator uses task → creates child session
  ↓
Child session has OWN orchestration state
  ↓
Child: { rootAgent: "general", currentAgent: "general" }
Parent: { rootAgent: "orchestrator", currentAgent: "orchestrator" }
  ↓
Child completes, parent resumes
  ↓
Parent's next message: currentAgent stays "orchestrator"
```

## UI Implementation Guide

### Footer Display

**Requirement**: Show current agent, and if switched, show hierarchy

**Implementation**:

```typescript
function AgentFooter({ sessionID }: { sessionID: string }) {
  const session = useSession(sessionID)

  // Get agent info
  const rootAgent = session.orchestration?.rootAgent || "general"
  const currentAgent = session.orchestration?.currentAgent || rootAgent

  // Determine display
  const isSwitched = currentAgent !== rootAgent

  return (
    <div className="agent-footer">
      {isSwitched ? (
        <>
          <span className="current-agent">{currentAgent.toUpperCase()}</span>
          <span className="separator"> › </span>
          <span className="root-agent">{rootAgent.toUpperCase()}</span>
        </>
      ) : (
        <span className="agent">{rootAgent.toUpperCase()}</span>
      )}
    </div>
  )
}
```

**Examples**:

- Not switched: `[ORCHESTRATOR]`
- Switched to architect: `[ARCHITECT › ORCHESTRATOR]`
- Switched to plan: `[PLAN › ORCHESTRATOR]`
- Back to orchestrator: `[ORCHESTRATOR]`

### Message List Badges

**Requirement**: Show which agent generated each message

**Implementation**:

```typescript
function MessageItem({ message }: { message: MessageV2.WithParts }) {
  if (message.info.role !== "assistant") {
    return <UserMessage message={message} />
  }

  // Get agent from message
  const agentName = message.info.mode // e.g., "orchestrator", "architect"

  return (
    <div className="message assistant">
      <div className="message-header">
        <span className={`agent-badge agent-${agentName}`}>
          {agentName.toUpperCase()}
        </span>
        <span className="timestamp">
          {formatTime(message.info.time.created)}
        </span>
      </div>
      <div className="message-content">
        <MessageParts parts={message.parts} />
      </div>
    </div>
  )
}
```

**Styling suggestions**:

```css
.agent-badge {
  font-size: 0.75rem;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 3px;
  text-transform: uppercase;
}

.agent-orchestrator {
  background: #3b82f6;
  color: white;
}

.agent-architect {
  background: #8b5cf6;
  color: white;
}

.agent-plan {
  background: #10b981;
  color: white;
}

.agent-general {
  background: #6b7280;
  color: white;
}
```

## Database Schema

```typescript
interface Session {
  orchestration?: {
    depth: number
    status: "active" | "paused" | "completed" | "failed"
    rootAgent?: string // ← NEW: Original agent (never changes)
    currentAgent?: string // ← NEW: Current agent (updates every message)
    pausedMode?: string // For resuming after child task
    pausedAt?: number
    completedAt?: number
    result?: string
  }
}

interface AssistantMessage {
  role: "assistant"
  mode: string // ← Agent that created this message
  time: { created: number }
  // ... other fields
}
```

## Querying Agent Info

### Get Current Session Agent

```typescript
const session = await Session.get(sessionID)
const currentAgent = session.orchestration?.currentAgent || "general"
const rootAgent = session.orchestration?.rootAgent || currentAgent
```

### Get Message Agent

```typescript
const messages = await Session.messages(sessionID)
messages.forEach((msg) => {
  if (msg.info.role === "assistant") {
    console.log(`Message by: ${msg.info.mode}`)
  }
})
```

### Check If Switched

```typescript
const session = await Session.get(sessionID)
const isSwitched = session.orchestration?.currentAgent !== session.orchestration?.rootAgent
```

## Edge Cases Handled

### 1. Session Without Orchestration State

```typescript
// Old sessions created before this feature
const currentAgent = session.orchestration?.currentAgent || "general"
const rootAgent = session.orchestration?.rootAgent || currentAgent
```

### 2. First Message in New Session

```typescript
// Automatically creates orchestration state:
// { rootAgent: "orchestrator", currentAgent: "orchestrator" }
```

### 3. Child Task Sessions

```typescript
// Child has its own independent orchestration state
// Parent's state is unaffected
```

### 4. Multiple Rapid Switches

```typescript
// Each message updates currentAgent
// Always shows the agent that created the LAST message
```

### 5. Concurrent Sessions

```typescript
// Each session has independent orchestration state
// No cross-session interference
```

## Testing

### Test 1: Basic Tracking

```bash
opencode run --agent orchestrator "Hello"
```

**Expected DB State**:

```json
{
  "orchestration": {
    "rootAgent": "orchestrator",
    "currentAgent": "orchestrator"
  }
}
```

### Test 2: Mode Switch

```bash
opencode run --agent orchestrator "Create architecture docs"
```

**Expected Sequence**:

1. First message: `{ rootAgent: "orchestrator", currentAgent: "orchestrator" }`
2. After switch to architect: `{ rootAgent: "orchestrator", currentAgent: "architect" }`
3. After switch back: `{ rootAgent: "orchestrator", currentAgent: "orchestrator" }`

### Test 3: Task Delegation

```bash
opencode run --agent orchestrator "Implement feature"
```

**Expected**:

- Parent session: `rootAgent: "orchestrator"`
- Child session: `rootAgent: "general"` (separate session)
- Parent's currentAgent never changes to "general"

## Performance Considerations

**Update Frequency**: On every assistant message creation

**Cost**: Minimal

- Single DB update per message
- No complex queries or joins
- Indexed session lookups

**Optimization**: State update is part of message creation transaction

## Migration

**Backward Compatibility**: ✅ Full

- Old sessions without orchestration state: Use defaults
- Optional fields in schema
- No breaking changes

**Migration Not Required**: System handles missing fields gracefully

## Monitoring

### Check Agent Distribution

```sql
SELECT
  json_extract(orchestration, '$.rootAgent') as root_agent,
  json_extract(orchestration, '$.currentAgent') as current_agent,
  COUNT(*) as count
FROM session
WHERE orchestration IS NOT NULL
GROUP BY root_agent, current_agent;
```

### Find Mode Switches

```sql
SELECT
  id,
  json_extract(orchestration, '$.rootAgent') as root,
  json_extract(orchestration, '$.currentAgent') as current
FROM session
WHERE orchestration IS NOT NULL
  AND json_extract(orchestration, '$.rootAgent') != json_extract(orchestration, '$.currentAgent');
```

## Troubleshooting

### Q: Agent not updating in UI

**A**: Check that you're reading from `session.orchestration.currentAgent`, not from messages

### Q: RootAgent and currentAgent both undefined

**A**: Old session created before this feature. Use default: `"general"`

### Q: Agent shows wrong after mode switch

**A**: Ensure you're polling session state, not caching it

### Q: Child task shows parent agent

**A**: Check that you're querying the correct session ID (child vs parent)

## Future Enhancements

**Potential additions**:

- Agent switch history: Track all switches in array
- Agent timing: Track how long each agent was active
- Agent stats: Count messages per agent
- Validation: Verify agent transitions are valid

## Summary

- ✅ **Automatic**: Tracks agent on every message
- ✅ **Accurate**: Always shows actual executing agent
- ✅ **Complete**: Handles all scenarios (switches, tasks, resumptions)
- ✅ **Efficient**: Minimal overhead, part of message creation
- ✅ **Compatible**: Works with old sessions, no migration needed
- ✅ **Queryable**: Easy to get current/root agent from session
- ✅ **UI-Ready**: Designed for footer hierarchy and message badges
