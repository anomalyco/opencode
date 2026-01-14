# Data Model: File Activity Highlight

**Date**: 2026-01-14
**Feature**: 003-file-activity-highlight

## Overview

This document defines the data structures for tracking and displaying file activity in the workspace sidebar. All data is session-scoped and stored in-memory using Solid.js stores.

---

## Entities

### FileActivityType (Enumeration)

Represents the type of AI interaction with a file.

| Value | Description |
|-------|-------------|
| `read` | File was read by the AI for context |
| `edited` | Existing file was modified by the AI |
| `created` | New file was created by the AI |

**Precedence**: `created` > `edited` > `read`

When a file has multiple activities, the highest precedence type is displayed.

---

### FileActivityState

Represents the activity state for a single file.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `FileActivityType` | Yes | The highest-precedence activity type |
| `timestamp` | `number` | Yes | Unix timestamp of most recent activity |
| `messageId` | `string` | Yes | ID of the message that caused this activity |
| `toolCalls` | `string[]` | No | List of tool call IDs for this file |

**Notes**:
- `timestamp` uses `Date.now()` for real-time ordering
- `toolCalls` enables tracking all operations on a file if needed for debugging

---

### FileActivityStore

The root store structure for activity tracking.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionId` | `string \| undefined` | No | Current session being tracked |
| `files` | `Record<string, FileActivityState>` | Yes | Map of file paths to activity states |

**Invariants**:
- `files` keys are relative paths from workspace root (matching `LocalFile.path`)
- When `sessionId` changes, `files` is cleared (FR-007)
- Empty by default until first tool part event

---

### VisualIndicatorConfig

Configuration for rendering activity indicators in the UI.

| Activity Type | Background Class | Border Class | Text Class | Badge Text |
|---------------|-----------------|--------------|------------|------------|
| `read` | `bg-surface-diff-add-base/50` | `border-icon-success-base/30` | `text-icon-success-base` | "read" |
| `edited` | `bg-surface-critical-base/50` | `border-icon-critical-base/30` | `text-icon-critical-base` | "edited" |
| `created` | `bg-surface-warning-base/50` | `border-icon-warning-base/30` | `text-icon-warning-base` | "created" |

**Notes**:
- Uses 50% opacity backgrounds to maintain file tree readability
- 30% opacity borders for subtle distinction
- Badge text is lowercase for consistency with existing UI patterns

---

## State Transitions

### Activity Type Transitions

```text
          ┌─────────────────────────────────────────┐
          │                                         │
          ▼                                         │
  [none] ──> [read] ──> [edited] ──> [created]      │
          │      │           │                      │
          │      └───────────┼──────────────────────┘
          │                  │     (cannot downgrade)
          └──────────────────┘
```

**Rules**:
- A file can only move UP in precedence (read → edited → created)
- Once a file is marked `created`, it stays `created` for the session
- Read operations never downgrade edited/created status

### Session Transitions

```text
  [tracking session A] ──session change──> [tracking session B]
                                                    │
                                         clear all files
```

---

## Computed Properties

### DirectoryActivityType

Aggregated activity type for a directory based on its children.

**Algorithm**:
```text
1. Find all files under directory path
2. If any child has type = 'created' → return 'created'
3. If any child has type = 'edited' → return 'edited'
4. If any child has type = 'read' → return 'read'
5. Return undefined (no activity)
```

---

## Tool Name Mapping

Maps SDK tool names to activity types.

| Tool Name | Activity Type | Notes |
|-----------|--------------|-------|
| `Read` | `read` | Always read |
| `Edit` | `edited` | Always edited |
| `Write` | `created` or `edited` | `created` if file didn't exist, `edited` otherwise |
| `NotebookEdit` | `edited` | Always edited |

**Determining Write vs Create**:
- Check `local.file.node(path)` before processing write event
- If node exists → `edited`
- If node doesn't exist → `created`

---

## Storage Characteristics

| Characteristic | Value |
|----------------|-------|
| Persistence | None (in-memory only) |
| Scope | Per workspace instance |
| Lifetime | Current session only |
| Maximum entries | Unbounded (limited by session activity) |
| Memory per entry | ~100 bytes (path string + state object) |

---

## Example State

```typescript
// After AI reads config.ts, edits main.ts, and creates new-file.ts:
{
  sessionId: "01JKXYZ...",
  files: {
    "src/config.ts": {
      type: "read",
      timestamp: 1705234567890,
      messageId: "msg_abc123",
      toolCalls: ["call_read_1"]
    },
    "src/main.ts": {
      type: "edited",
      timestamp: 1705234568000,
      messageId: "msg_abc123",
      toolCalls: ["call_read_2", "call_edit_1"]
    },
    "src/new-file.ts": {
      type: "created",
      timestamp: 1705234569000,
      messageId: "msg_abc123",
      toolCalls: ["call_write_1"]
    }
  }
}
```

---

## Integration with Existing Types

### LocalFile Extension

The `FileActivityState` complements but does not modify `LocalFile` type.

```typescript
// Existing LocalFile (unchanged)
export type LocalFile = FileNode & Partial<{
  loaded: boolean
  pinned: boolean
  expanded: boolean
  content: FileContent
  status: FileStatus
  // ...
}>

// Activity is separate, accessed via context
const activity = useFileActivity()
const fileActivity = activity.get(localFile.path)  // FileActivityState | undefined
```

### ToolPart Input Extraction

```typescript
// Extract file path from ToolPart
function extractFilePath(part: ToolPart): string | undefined {
  const input = part.state.input
  return input?.file_path as string | input?.path as string | undefined
}
```
