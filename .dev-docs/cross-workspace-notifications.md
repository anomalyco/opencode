# Cross-Workspace Notification Alerts

## Overview

Extend the notification system with two features:
1. **Workspace status dots** - Show indicators (working/attention/done) on workspaces in the WorkspaceBar
2. **Expandable summary panel** - Show a 240-char summary panel at the bottom when agent completes (one at a time)

## Current State

**Tab-level notifications work like this:**
1. Agent hooks send lifecycle events (`Start`/`Stop`/`PermissionRequest`) to `/hook/agent-lifecycle`
2. `listener.ts` receives events and updates `terminalAgentStatus` per terminal
3. `getTabAgentStatus()` aggregates terminal status per tab
4. Tab UI shows: LoadingIndicator (amber), AttentionDot (red), DoneDot (green)
5. DoneDot only shows on **inactive** tabs

**Existing workspace infrastructure:**
- `WorkspaceBarItem` type already has `notification?: boolean` field
- `WorkspaceNotificationDot` component exists (green dot)
- Events already include `workspaceId` in payload

## Implementation Plan

### Phase 1: Data Model (claxedo-layout.tsx)

Add to `ClaxedoLayoutStore`:

```typescript
// Workspace-level agent status (persisted)
workspaceAgentStatus: Record<string, {
  loading: boolean
  attention: boolean
  done: boolean
  lastSummary?: string  // 240-char summary
  unseenCompletions: number
} | undefined>
```

Add methods:
- `getWorkspaceAgentStatus(workspaceId)` - aggregate status across all tabs in workspace
- `markWorkspaceCompleted(workspaceId, summary?)` - called when agent finishes in inactive workspace
- `clearWorkspaceNotification(workspaceId)` - called when user switches to workspace

**File:** `packages/claxedo-app/src/claxedo-ui/context/claxedo-layout.tsx`

### Phase 2: Event Listener (listener.ts)

Modify `useAgentLifecycleListener`:
1. On `Stop` event, check if `workspaceId !== activeWorkspaceId`
2. If inactive workspace, call `markWorkspaceCompleted(workspaceId)`
3. Play notification sound for inactive workspace completions

Add `useClearWorkspaceNotificationOnSwitch`:
1. Watch for `activeWorkspaceId` changes
2. Clear notification for newly active workspace

**File:** `packages/claxedo-app/src/agent-hooks/listener.ts`

### Phase 3: UI Types (top-tab-bar.tsx)

Update `WorkspaceBarItem`:

```typescript
export type WorkspaceBarItem = {
  id: string
  directory: string
  name: string
  active?: boolean
  notification?: boolean  // backward compat
  status?: {              // NEW: detailed status
    loading: boolean
    attention: boolean
    done: boolean
    unseenCompletions: number
  }
}
```

Add components:
- `WorkspaceLoadingIndicator` - pulsing amber dot (8px)
- `WorkspaceAttentionDot` - pulsing red dot (8px)

Update `WorkspaceBarProjectGroup` to render:
- `WorkspaceLoadingIndicator` when `status.loading`
- `WorkspaceAttentionDot` when `status.attention && !loading`
- `WorkspaceNotificationDot` when `status.done && !loading && !attention`
- Badge count when `unseenCompletions > 1`

**File:** `packages/claxedo-app/src/claxedo-ui/layouts/top-tab-bar.tsx`

### Phase 4: Integration (rail-layout.tsx)

Update `workspaceBarProjects` computation:
1. Call `getWorkspaceAgentStatus(ws.directory)` for each workspace
2. Pass status to `WorkspaceBarItem`
3. Always show workspaces with active notifications (even if >5 workspaces)

Wire up workspace selection:
1. In `handleWorkspaceBarWorkspaceSelect`, call `clearWorkspaceNotification`

**File:** `packages/claxedo-app/src/claxedo-ui/layouts/rail-layout.tsx`

### Phase 5: Expandable Summary Panel (NEW COMPONENT)

Create a notification panel that slides up from the bottom when an agent completes:

**Component:** `WorkspaceNotificationPanel`

```typescript
type NotificationPanelState = {
  visible: boolean
  workspaceId: string | null
  workspaceName: string
  summary: string  // 240 chars max
  timestamp: number
}
```

**Behavior:**
- Panel slides up from bottom (similar to a toast but persistent until dismissed)
- Shows workspace name + 240-char summary of changes
- One at a time: if multiple agents finish, queue them (show next after dismiss)
- Auto-dismiss after 10 seconds OR when user clicks workspace OR clicks dismiss
- Clicking the panel navigates to that workspace

**UI Design:**
```
┌─────────────────────────────────────────────────────────────────┐
│  [workspace-icon] feature-auth completed                    [x] │
│  Fixed authentication bug in login.tsx, added validation...     │
└─────────────────────────────────────────────────────────────────┘
```

**State Management:**
- Add `notificationQueue: NotificationPanelState[]` to store
- Add `showNextNotification()` method
- Add `dismissNotification()` method

**File:** New component `packages/claxedo-app/src/claxedo-ui/components/workspace-notification-panel.tsx`

### Phase 6: Summary Extraction (Agent-Specific)

Getting the last message depends on the agent:

| Agent | Access Method |
|-------|---------------|
| **Claude CLI** | `transcript_path` in hook payload → read JSONL file |
| **OpenCode** | SDK access to session messages |
| **Codex** | No structured access - fallback to "Agent completed" |
| **Others** | No structured access - fallback to "Agent completed" |

**Implementation:**

**A. Modify notify.sh to extract Claude message:**
```bash
# Extract transcript_path from input JSON
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty')

# If Claude hook with transcript, extract last assistant message
if [ -n "$TRANSCRIPT_PATH" ] && [ -f "$TRANSCRIPT_PATH" ]; then
  LAST_MSG=$(tail -10 "$TRANSCRIPT_PATH" | grep '"role":"assistant"' | tail -1 | jq -r '.content[:500]')
fi

# Send with hook request
curl ... --data-urlencode "lastMessage=$LAST_MSG"
```

**B. Update agent-lifecycle endpoint to accept lastMessage:**
- Add `lastMessage?: string` to payload
- Pass to frontend via SSE event

**C. LLM Summarization (for all agents):**
1. If `lastMessage` provided, send to LLM for 240-char summary
2. If no `lastMessage`, show generic "Agent completed" message
3. LLM prompt: "Summarize this in 240 characters or less: {lastMessage}"
4. Fallback: truncate `lastMessage` to 240 chars if LLM fails

**Files:**
- `packages/opencode/src/agent-hooks/index.ts` - modify `generateNotifyScript()` to extract transcript
- `packages/opencode/src/server/routes/agent-hook.ts` - accept `lastMessage` parameter
- `packages/claxedo-app/src/agent-hooks/listener.ts` - trigger LLM summarization

## Files to Modify

| File | Changes |
|------|---------|
| `claxedo-layout.tsx` | Add `workspaceAgentStatus` store, `notificationQueue`, add methods |
| `listener.ts` | Add workspace-level tracking, LLM summarization, notification queueing |
| `top-tab-bar.tsx` | Extend types, add 2 indicator components, update rendering |
| `rail-layout.tsx` | Wire up status computation and clearing, mount notification panel |
| `workspace-notification-panel.tsx` | **NEW:** Expandable summary panel component |
| `agent-hooks/index.ts` | Modify `generateNotifyScript()` to extract `transcript_path` content |
| `server/routes/agent-hook.ts` | Accept `lastMessage` parameter in endpoint |

## Event Flow

```
Agent finishes in workspace B (user viewing workspace A)
    |
    v
[listener.ts] useAgentLifecycleListener()
    | workspaceId !== activeWorkspaceId
    | extract summary from last message
    v
[claxedo-layout.tsx] markWorkspaceCompleted("B", summary)
    | sets: done=true, unseenCompletions++
    | adds to notificationQueue
    v
[WorkspaceBar] Reactively shows green dot on workspace B
[WorkspaceNotificationPanel] Shows panel with summary
    |
    v (after 10s or user action)
[claxedo-layout.tsx] dismissNotification()
    | removes from queue, shows next if any
    v
User clicks workspace B
    |
    v
[claxedo-layout.tsx] clearWorkspaceNotification("B")
```

## Verification

1. Open two terminal tabs in different workspaces (A and B)
2. Switch to workspace A
3. Run an agent in workspace B's terminal (e.g., `claude "hello"`)
4. Verify:
   - Green dot appears on workspace B in the WorkspaceBar
   - Summary panel slides up from bottom showing workspace name + summary
5. Wait 10 seconds OR click dismiss
6. Verify panel disappears
7. Switch to workspace B
8. Verify green dot disappears
9. Test loading indicator: start agent in inactive workspace, verify amber dot
10. Test attention indicator: trigger permission request in inactive workspace, verify red dot
11. Test queue: trigger completions in multiple inactive workspaces, verify they show one at a time

## Agent Hook Research Summary

### Claude CLI Hooks
- **Available events:** `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PostToolUseFailure`, `Notification`, `SubagentStart`, `SubagentStop`, `Stop`, `PreCompact`, `SessionEnd`
- **Data in Stop hook:** `session_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name`
- **Message access:** Read `transcript_path` JSONL file (not included directly in hook)

### Gemini CLI Hooks
- **Available events:** `BeforeAgent`, `AfterAgent`, `BeforeTool`, `AfterTool`, `BeforeModel`, `BeforeToolSelection`
- **Limitation:** "Non-text parts are filtered out"

### OpenCode Events
- **Available events:** `session.status`, `session.busy`, `session.idle`, `session.error`, `permission.ask`
- **Data:** Status only, no message content
- **Message access:** Read session transcript files

### Codex CLI
- **Notification events:** `agent-turn-complete`, `agent-turn-start`, `permission-request`
- **No message content** in notifications

### Aider CLI
- **Basic notifications:** bell + optional command
- **No structured data** passed

### Goose
- **No documented hooks/events system**
