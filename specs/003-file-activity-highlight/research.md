# Research: File Activity Highlight

**Date**: 2026-01-14
**Feature**: 003-file-activity-highlight

## Executive Summary

Research confirms the existing codebase provides all necessary infrastructure for implementing file activity highlighting. The implementation will leverage the Solid.js event system, reactive stores, and existing UI patterns without requiring new external dependencies.

---

## Research Tasks

### 1. Event System for File Operations

**Decision**: Use `message.part.updated` events from the SDK event emitter to track file operations

**Rationale**:
- The SDK already broadcasts events for all message parts including tool calls
- `ToolPart` type includes `tool` field (tool name like "Read", "Write", "Edit") and `state.input` containing file paths
- Events are directory-scoped, ensuring activities are tracked per-workspace

**Alternatives considered**:
- Custom file watcher events: Rejected - doesn't capture AI-specific operations vs user file changes
- Polling tool parts: Rejected - inefficient compared to reactive event-driven approach

**Key Types** (from `packages/sdk/js/src/v2/gen/types.gen.ts`):
```typescript
export type ToolPart = {
  id: string
  sessionID: string
  messageID: string
  type: "tool"
  callID: string
  tool: string  // LOWERCASE: "read", "write", "edit", "glob", "grep", etc.
  state: ToolState
  metadata?: Record<string, unknown>
}

export type ToolStateCompleted = {
  status: "completed"
  input: Record<string, unknown>  // Contains filePath (camelCase) for file operations
  output: string
  title: string
  // ...
}
```

**Sample Events** (actual console output):
```javascript
// Read tool event:
{
  tool: "read",
  input: {
    filePath: "/Users/user/workspace/project/src/file.ts",  // ABSOLUTE path, camelCase
    offset: 0
  },
  mapLookup: "read"
}

// Edit tool event:
{
  tool: "edit",
  input: {
    filePath: "/Users/user/workspace/project/src/file.ts",  // ABSOLUTE path, camelCase
    newString: "...",
    oldString: "..."
  },
  mapLookup: "edit"
}

// Glob tool event (no file activity):
{
  tool: "glob",
  input: { pattern: "*proposal*" },
  mapLookup: undefined
}
```

**IMPORTANT NOTES**:
1. Tool names are **lowercase** in events (e.g., `"read"`, not `"Read"`)
2. File paths use **camelCase** (`filePath`, not `file_path`)
3. File paths are **absolute** (e.g., `/Users/user/workspace/...`)
4. FileNode in file-tree has both `path` (relative) and `absolute` fields - use `absolute` for matching

### 2. State Management Pattern

**Decision**: Create a new `file-activity.tsx` context with Solid.js `createStore`

**Rationale**:
- Follows established pattern in `local.tsx` for file state
- Separate context keeps activity logic isolated from core file operations
- Solid.js reactivity ensures UI updates automatically when activity state changes
- Session-scoped state (no persistence) matches requirement FR-007

**Alternatives considered**:
- Extend LocalFile type with activity field: Rejected - mixes concerns, activity is session-scoped while file state is workspace-scoped
- Store activity in sync context: Rejected - activity is frontend-only, not synced with backend
- Use signals instead of store: Rejected - store provides better structure for path-keyed data

**Implementation Pattern**:
```typescript
const [activityStore, setActivityStore] = createStore<{
  files: Record<string, FileActivityState>
  sessionId: string | undefined
}>({
  files: {},
  sessionId: undefined,
})
```

### 3. Visual Indicator Design

**Decision**: Use theme colors + badge tags following existing indicator patterns

**Rationale**:
- Theme already defines semantic colors (success, warning, critical)
- Existing `session-lsp-indicator.tsx` demonstrates the indicator pattern
- Badges can use existing Tailwind utility classes

**Color Mapping** (from `packages/ui/src/theme/themes/openwork.json`):
| Activity Type | Background Color | Icon Color | Tag Text |
|---------------|-----------------|------------|----------|
| Read | `surface-diff-add-base` (#dafbe0) | `icon-success-base` (#34c759) | "read" |
| Edited | `surface-critical-base` (var(--ember-light-3)) | `icon-critical-base` (#ff3b30) | "edited" |
| Created | `surface-warning-base` (implied) | `icon-warning-base` (#ff9500) | "created" |

**Alternatives considered**:
- Custom colors: Rejected - use existing theme for consistency
- Icons only: Rejected - spec requires tags/badges for accessibility
- Animations: Rejected - adds complexity without clear user value

### 4. FileTree Integration Points

**Decision**: Extend `FileTree` component with activity-aware styling

**Rationale**:
- FileTree already renders file nodes with conditional styling
- `classList` pattern supports adding activity-based classes
- Component receives props that can include activity state

**Current FileTree Structure** (from `packages/app/src/components/file-tree.tsx`):
```tsx
// Existing conditional styling pattern:
classList={{
  "bg-surface-interactive-base border border-border-weak-selected": isSelected,
  "hover:bg-surface-raised-base-hover": !isSelected,
  "text-text-subtle": node.ignored,
  "text-text-strong": isSelected,
  "text-text-base": !isSelected && !node.ignored,
}}
```

**Extension points**:
1. Add `activityType?: 'read' | 'edited' | 'created'` to node styling logic
2. Add badge component after filename text
3. Add background highlight classes based on activity

### 5. Session Boundary Detection

**Decision**: Use `sessionID` from ToolPart events to scope activity

**Rationale**:
- Each ToolPart includes `sessionID` field
- Activity context can track current session and clear when it changes
- Matches spec requirement FR-007 (clear on new session)

**Implementation**:
```typescript
// When processing tool part event:
if (currentSessionId !== part.sessionID) {
  // New session detected, clear previous activities
  setActivityStore("files", {})
  setActivityStore("sessionId", part.sessionID)
}
```

### 6. Parent Directory Aggregation

**Decision**: Compute aggregated activity using memo functions

**Rationale**:
- Solid.js `createMemo` automatically tracks dependencies
- Aggregation can be computed on-demand when rendering collapsed directories
- Efficient - only recalculates when activity state changes

**Algorithm**:
```typescript
const directoryActivity = createMemo(() => {
  const files = activityStore.files
  const hasEditedChild = Object.entries(files)
    .some(([path, state]) =>
      path.startsWith(directoryPath + '/') &&
      (state.type === 'edited' || state.type === 'created'))
  const hasReadChild = Object.entries(files)
    .some(([path, state]) =>
      path.startsWith(directoryPath + '/') &&
      state.type === 'read')

  if (hasEditedChild) return 'edited'  // edited/created takes precedence
  if (hasReadChild) return 'read'
  return undefined
})
```

### 7. Tool Names for File Operations

**Decision**: Map tool names to activity types

**Mapping** (tool names are **lowercase**):
| Tool Name | Activity Type |
|-----------|--------------|
| `read` | read |
| `write` | created (if file didn't exist) or edited |
| `edit` | edited |
| `notebookedit` | edited |

**Implementation** (from `packages/app/src/types/file-activity.ts`):
```typescript
export const TOOL_ACTIVITY_MAP: Record<string, "read" | "edit" | "write" | undefined> = {
  read: "read",
  edit: "edit",
  write: "write",
  notebookedit: "edit",
  // Other tools don't track file activity
  bash: undefined,
  glob: undefined,
  grep: undefined,
  webfetch: undefined,
  websearch: undefined,
  todowrite: undefined,
  task: undefined,
}
```

**Note**: Need to track file existence before write to differentiate created vs edited. Check if file already has activity in the store - if so, treat as "edited", otherwise "created".

---

## Implementation Recommendations

### Phase 1: Core Activity Tracking
1. Create `FileActivityState` type definition
2. Create `file-activity.tsx` context with store
3. Subscribe to `message.part.updated` events
4. Extract file paths from ToolPart inputs
5. Update activity store based on tool type

### Phase 2: Visual Integration
1. Create `FileActivityBadge` component
2. Modify `FileTree` to accept activity context
3. Add activity-based styling classes
4. Implement parent directory aggregation

### Phase 3: Session Management
1. Track current session ID
2. Clear activity on session change
3. Handle edge cases (file rename, delete)

---

## Dependencies

No new external dependencies required. Implementation uses:
- `solid-js/store` - already included
- `@solid-primitives/event-bus` - already included for event handling
- Tailwind CSS - already included for styling
- Theme tokens from `openwork.json` - already defined

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Performance with many files | Low | Medium | Use memos for aggregation, batch updates |
| Event ordering issues | Low | Low | Track timestamp, use latest activity |
| Theme color accessibility | Low | High | Use existing WCAG-compliant theme colors |
| Memory growth with long sessions | Low | Low | Activity state is lightweight (path + type only) |
