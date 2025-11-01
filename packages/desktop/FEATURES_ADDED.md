# Desktop App Features - Implementation Summary

## 1. Auto-Scroll to Latest Messages

**Feature**: When clicking on a session in the left sidebar, the message view automatically scrolls to the bottom (latest messages).

**Implementation**: 
- Added `createEffect` that watches for active session changes
- Scrolls `messageScrollElement` to bottom when session is selected
- 100ms delay ensures content is fully rendered before scrolling

**Location**: `src/pages/index.tsx` (lines ~66-76)

## 2. Active Session Indicators

**Feature**: Sessions with actively running processes show a pulsing green dot indicator.

**How It Works**:
- Checks all messages and parts for each session
- Detects `ToolPart` with status `"pending"` or `"running"`
- Real-time updates as parts change

**Visual Indicator**:
- Pulsing green dot (2x2px, rounded) next to session title
- Only shows when session has active tool execution

**Implementation**:
```typescript
const isSessionActive = (sessionId: string) => {
  const messages = sync.data.message[sessionId] || []
  for (const message of messages) {
    const parts = sync.data.part[message.id] || []
    for (const part of parts) {
      if (part.type === 'tool' && 
          (part.state.status === 'pending' || 
           part.state.status === 'running')) {
        return true
      }
    }
  }
  return false
}
```

**Location**: `src/pages/index.tsx` (lines ~78-89, ~420-449)

## What This Enables

1. **Better UX**: No manual scrolling needed to see latest AI responses
2. **Activity Awareness**: Instantly see which sessions are actively processing
3. **Multi-Session Management**: Easily track multiple concurrent sessions

## Technical Details

- Uses SolidJS `createEffect` for reactive updates
- Leverages existing sync state (`sync.data.message`, `sync.data.part`)
- No additional API calls or state management needed
- CSS animations use Tailwind's `animate-pulse` utility

## Testing

To test:
1. Start a session with a long-running command
2. Switch to another session
3. Switch back - should auto-scroll to bottom
4. Active session should show green pulsing dot
5. Dot disappears when all tools complete
