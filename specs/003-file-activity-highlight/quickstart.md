# Quickstart: File Activity Highlight

**Feature**: 003-file-activity-highlight
**Date**: 2026-01-14

## Overview

This guide provides a quick reference for implementing the file activity highlight feature. It covers the essential steps without deep implementation details.

---

## Prerequisites

- Node.js and pnpm installed
- Repository cloned and dependencies installed (`pnpm install`)
- Development server running (`pnpm dev`)

---

## Key Files to Create/Modify

### New Files

| File | Purpose |
|------|---------|
| `packages/app/src/types/file-activity.ts` | Type definitions |
| `packages/app/src/context/file-activity.tsx` | Activity tracking context |
| `packages/app/src/components/file-activity-badge.tsx` | Badge component |

### Modified Files

| File | Changes |
|------|---------|
| `packages/app/src/components/file-tree.tsx` | Add activity styling + badge |
| `packages/app/src/components/workspace-sidebar.tsx` | Wrap with activity provider |

---

## Implementation Order

### Step 1: Types (30 min)

Create `packages/app/src/types/file-activity.ts`:

```typescript
export type FileActivityType = "read" | "edited" | "created"

export interface FileActivityState {
  type: FileActivityType
  timestamp: number
  messageId: string
  toolCalls?: string[]
}
```

### Step 2: Context (2 hours)

Create `packages/app/src/context/file-activity.tsx`:

1. Create store with `createStore`
2. Subscribe to `message.part.updated` events
3. Extract file paths from ToolPart inputs
4. Implement `recordRead`, `recordEdit`, `recordCreate` actions
5. Implement `get`, `has`, `getDirectoryActivity` queries
6. Handle session changes (clear on new session)

```typescript
// Pattern to follow from local.tsx:
export const { use: useFileActivity, provider: FileActivityProvider } = createSimpleContext({
  name: "FileActivity",
  init: () => {
    const sdk = useSDK()
    const local = useLocal()
    const [store, setStore] = createStore<FileActivityStore>({ ... })

    // Subscribe to events
    const unsub = sdk.event.listen((e) => {
      if (e.details.type === "message.part.updated") {
        const part = e.details.properties.part
        if (part.type === "tool" && part.state.status === "completed") {
          // Extract path and record activity
        }
      }
    })

    return { get, has, getDirectoryActivity, ... }
  }
})
```

### Step 3: Badge Component (1 hour)

Create `packages/app/src/components/file-activity-badge.tsx`:

```typescript
import { ACTIVITY_VISUAL_CONFIG } from "@/types/file-activity"

export function FileActivityBadge(props: { type: FileActivityType }) {
  const config = ACTIVITY_VISUAL_CONFIG[props.type]
  return (
    <span class={`px-1 py-0.5 rounded text-10-regular ${config.badgeBackground} ${config.badgeText}`}>
      {config.label}
    </span>
  )
}
```

### Step 4: FileTree Integration (1 hour)

Modify `packages/app/src/components/file-tree.tsx`:

1. Import `useFileActivity` context
2. Get activity state for each file node
3. Add conditional classes based on activity type
4. Render `FileActivityBadge` after filename

```typescript
// In the file node rendering:
const activity = useFileActivity()
const fileActivity = activity.get(node.path)

// Add to classList:
classList={{
  ...existingClasses,
  [ACTIVITY_VISUAL_CONFIG[fileActivity?.type]?.background]: !!fileActivity,
  [ACTIVITY_VISUAL_CONFIG[fileActivity?.type]?.border]: !!fileActivity,
}}

// After filename:
{fileActivity && <FileActivityBadge type={fileActivity.type} />}
```

### Step 5: Provider Integration (30 min)

Wrap FileTree with provider in `workspace-sidebar.tsx`:

```typescript
<FileActivityProvider>
  <FileTree ... />
</FileActivityProvider>
```

---

## Testing Checklist

- [ ] File read → green "read" badge appears
- [ ] File edit → red "edited" badge appears
- [ ] File create → orange "created" badge appears
- [ ] Read then edit → shows "edited" (precedence)
- [ ] New session → all badges cleared
- [ ] Collapsed directory → shows aggregated badge
- [ ] Multiple files → each has correct badge

---

## Visual Reference

```
📁 src/
├── 📄 config.ts         [read]
├── 📄 main.ts           [edited]
└── 📄 new-component.tsx [created]
```

---

## Troubleshooting

### Badges not appearing

1. Check event listener is receiving `message.part.updated` events
2. Verify ToolPart has `state.status === "completed"`
3. Confirm file path extraction from `state.input.file_path`

### Wrong activity type

1. Check tool name mapping (`Read`, `Edit`, `Write`)
2. Verify precedence logic (created > edited > read)

### Badges persist after session change

1. Verify `sessionId` is being tracked
2. Ensure `clear()` is called when session changes
3. Check event includes `part.sessionID`

---

## Reference Files

- [spec.md](./spec.md) - Full specification
- [research.md](./research.md) - Technical research
- [data-model.md](./data-model.md) - Data structures
- [contracts/file-activity-context.ts](./contracts/file-activity-context.ts) - TypeScript contracts

---

## Related Patterns

- `packages/app/src/context/local.tsx` - Store pattern reference
- `packages/app/src/components/session-lsp-indicator.tsx` - Indicator pattern
- `packages/ui/src/theme/themes/openwork.json` - Color tokens
