# Research: MCP Connectors API Alignment

**Feature**: 006-fix-mcp-api-alignment
**Date**: 2026-01-15
**Status**: Complete

## Overview

This document captures the research findings for aligning the MCP Connectors implementation with the project's actual API patterns. All "NEEDS CLARIFICATION" items from the Technical Context have been resolved.

---

## Research Area 1: File I/O API

### Question
How should file write operations be performed given that `sdk.client.file.write()` doesn't exist?

### Investigation
Examined the SDK client file interface and Tauri API patterns in the codebase.

**SDK File API (packages/app/src/context/sdk.tsx)**:
- `read({ path: string })` - exists
- `list({ path: string })` - exists
- `status({ path: string })` - exists
- `write()` - **does not exist**

**Tauri API Usage in Codebase**:
- `@tauri-apps/api` is already a dependency
- Other parts of the app use Tauri APIs directly

### Decision
Use `writeTextFile` from `@tauri-apps/api/fs`

### Rationale
- Native Tauri API, well-supported
- Already have the dependency installed
- Simpler than extending SDK (which would require backend changes)
- Follows patterns used elsewhere in Tauri apps

### Alternatives Considered
1. **Add SDK write method**: Would require Rust backend changes, not feasible for this fix
2. **Use Tauri invoke()**: More complex, writeTextFile is higher-level

### Implementation Pattern
```typescript
import { writeTextFile } from '@tauri-apps/api/fs'

// Replace: await sdk.client.file.write({ path, content })
// With:
await writeTextFile(path, content)
```

---

## Research Area 2: Dialog Component API

### Question
What is the correct Dialog component API and how should state be managed?

### Investigation
Examined `packages/ui/src/components/dialog.tsx` and usage patterns across the codebase.

**Dialog Component Props**:
```typescript
export interface DialogProps extends ParentProps {
  title?: JSXElement
  description?: JSXElement
  action?: JSXElement
  class?: ComponentProps<"div">["class"]
  classList?: ComponentProps<"div">["classList"]
}
```

**Key Finding**: The project's Dialog is a simple wrapper, NOT a compound component. It does NOT support:
- `Dialog.Content`
- `Dialog.Header`
- `Dialog.Title`
- `Dialog.Description`
- `Dialog.Footer`
- `open` / `onOpenChange` props

**Dialog State Management**:
The project uses a dialog service pattern via `useDialog()` hook from context.

### Decision
Refactor to use `useDialog()` hook for state management and simple Dialog props for content.

### Rationale
- Matches existing patterns in the codebase
- Dialog service handles open/close state automatically
- Cleaner component separation

### Alternatives Considered
1. **Use Kobalte Dialog directly**: Would break consistency with rest of codebase
2. **Extend Dialog component**: Adds unnecessary complexity

### Implementation Pattern
```typescript
import { useDialog } from '@opencode-ai/ui/context/dialog'
import { Dialog } from '@opencode-ai/ui'

const dialog = useDialog()

function showMyDialog() {
  dialog.show(() => (
    <Dialog
      title="My Title"
      description="My description"
    >
      {/* Content */}
      <div class="flex gap-2 justify-end mt-4">
        <Button variant="ghost" onClick={dialog.close}>Cancel</Button>
        <Button onClick={handleAction}>Confirm</Button>
      </div>
    </Dialog>
  ))
}
```

---

## Research Area 3: Available Icons

### Question
What icons are available and what should replace the missing ones?

### Investigation
Examined `packages/ui/src/components/icon.tsx` for the complete icon set.

**Available Icons** (64+ total):
- Navigation: `arrow-up`, `arrow-left`, `chevron-down`, `chevron-right`
- UI Actions: `close`, `plus`, `plus-small`, `check`, `copy`
- File/Folder: `folder`, `archive`, `file`
- Editing: `pencil-line`, `edit-small-2`, `expand`, `collapse`
- Code: `code`, `code-lines`, `console`
- Special: `mcp`, `glasses`, `brain`, `task`, `branch`, `server`
- Warning: `circle-error` (red X for errors)

**Missing Icons Needed**:
1. `spinner` - loading state
2. `edit` - edit button
3. `trash` - remove button
4. `lock` - sensitive env var
5. `alert-triangle` - error state

### Decision
Map to existing icons or use alternative approaches.

### Icon Mappings

| Missing Icon | Replacement | Notes |
|-------------|-------------|-------|
| `spinner` | CSS animation | Use `animate-spin` class on any icon |
| `edit` | `pencil-line` | Standard edit icon in set |
| `trash` | `close` | X icon for removal actions |
| `lock` | Text "(sensitive)" | No lock icon, use text indicator |
| `alert-triangle` | `circle-error` | Red X for error states |

### Rationale
- Use existing icons where semantic match exists
- CSS animation for loading states is standard pattern
- Text indicators are acceptable for low-frequency UI elements

---

## Research Area 4: IconButton Sizes

### Question
What sizes does IconButton support?

### Investigation
Examined `packages/ui/src/components/icon-button.tsx`.

**IconButton Props**:
```typescript
export interface IconButtonProps {
  icon: IconProps["name"]
  size?: "normal" | "large"  // NOT "small"
  iconSize?: IconProps["size"]  // "small" | "normal" | "large"
  variant?: "primary" | "secondary" | "ghost"
}
```

### Decision
Remove `size="small"` props, use default size ("normal").

### Rationale
- `size="small"` doesn't exist
- Default size is appropriate for most use cases
- Can use `iconSize="small"` if smaller icon is needed

### Implementation
```typescript
// Replace: <IconButton icon="close" size="small" />
// With:
<IconButton icon="close" />  // or iconSize="small" for smaller icon
```

---

## Research Area 5: Button Variants

### Question
What variants does the Button component support?

### Investigation
Examined `packages/ui/src/components/button.tsx`.

**Button Variants**:
```typescript
variant?: "primary" | "secondary" | "ghost"
```

**Missing**: `"destructive"` variant does not exist.

### Decision
Use `variant="primary"` for destructive actions (removal confirmation).

### Rationale
- Primary provides visual emphasis needed for important actions
- Color semantics can be added via custom class if needed later
- Consistency with existing patterns

### Implementation
```typescript
// Replace: <Button variant="destructive">Remove</Button>
// With:
<Button variant="primary">Remove</Button>
```

---

## Research Area 6: Toast API

### Question
What is the correct showToast() function signature?

### Investigation
Examined `packages/ui/src/components/toast.tsx`.

**Toast API**:
```typescript
export function showToast(options: ToastOptions | string)

export interface ToastOptions {
  title?: string
  description?: string
  icon?: IconProps["name"]
  variant?: "default" | "success" | "error" | "loading"
  duration?: number
  persistent?: boolean
  actions?: ToastAction[]
}
```

**Current Incorrect Usage**:
```typescript
showToast("Message", "success")  // 2 arguments
```

### Decision
Use single argument (string or options object).

### Rationale
- API accepts single argument
- Options object allows variant specification
- Simple string works for basic notifications

### Implementation Patterns
```typescript
// Simple
showToast("Connector added successfully")

// With variant
showToast({
  title: "Connector added successfully",
  variant: "success"
})

// With error
showToast({
  title: "Failed to add connector",
  description: error.message,
  variant: "error"
})
```

---

## Research Area 7: Zod Error Handling

### Question
How should Zod validation errors be accessed?

### Investigation
Examined Zod library documentation and current error handling code.

**ZodError Structure**:
```typescript
class ZodError {
  issues: ZodIssue[]  // CORRECT
  // errors: undefined - DOES NOT EXIST
}

interface ZodIssue {
  path: (string | number)[]
  message: string
  code: string
  // ...other fields
}
```

### Decision
Change `.errors` to `.issues` throughout the codebase.

### Rationale
- `.issues` is the correct Zod API
- Same structure, just different property name

### Implementation
```typescript
// Replace: error.errors.map(e => ...)
// With:
error.issues.map(e => ({
  field: e.path.join('.'),
  message: e.message
}))
```

---

## Summary

All research areas have been investigated and resolved:

| Area | Status | Key Finding |
|------|--------|-------------|
| File I/O | ✅ Resolved | Use Tauri writeTextFile |
| Dialog API | ✅ Resolved | Use useDialog() hook + simple props |
| Icons | ✅ Resolved | Map to existing icons + CSS animations |
| IconButton | ✅ Resolved | Remove size="small", use defaults |
| Button | ✅ Resolved | Use "primary" instead of "destructive" |
| Toast | ✅ Resolved | Single argument (string or options object) |
| Zod | ✅ Resolved | Use .issues instead of .errors |

**No NEEDS CLARIFICATION items remain.** Ready to proceed to Phase 1.
