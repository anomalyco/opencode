# Contract: Toast Notification API

**Feature**: 006-fix-mcp-api-alignment
**Component**: Toast (`@opencode-ai/ui`)

## Interface

```typescript
export function showToast(options: ToastOptions | string): void

export interface ToastOptions {
  title?: string
  description?: string
  icon?: IconProps["name"]
  variant?: "default" | "success" | "error" | "loading"
  duration?: number       // milliseconds, default varies by variant
  persistent?: boolean    // if true, doesn't auto-dismiss
  actions?: ToastAction[]
}

interface ToastAction {
  label: string
  onClick: () => void
}
```

## Correct Usage Patterns

### Pattern 1: Simple String Message

```typescript
import { showToast } from '@opencode-ai/ui'

// Simple notification
showToast("Changes saved successfully")
```

### Pattern 2: Success Notification

```typescript
showToast({
  title: "Connector added",
  description: `"${connectorName}" is now available`,
  variant: "success"
})
```

### Pattern 3: Error Notification

```typescript
showToast({
  title: "Failed to save",
  description: error.message,
  variant: "error"
})
```

### Pattern 4: Loading State

```typescript
showToast({
  title: "Saving changes...",
  variant: "loading",
  persistent: true  // Won't auto-dismiss
})
```

### Pattern 5: With Actions

```typescript
showToast({
  title: "Item deleted",
  description: "This action can be undone",
  variant: "default",
  actions: [
    {
      label: "Undo",
      onClick: handleUndo
    }
  ]
})
```

## Incorrect Usage (Do NOT Use)

```typescript
// ❌ WRONG: Two arguments
showToast("Message", "success")

// ❌ WRONG: Using 'type' instead of 'variant'
showToast({ message: "Text", type: "success" })

// ❌ WRONG: Using 'message' instead of 'title'
showToast({ message: "Text", variant: "success" })
```

## Variant Behavior

| Variant | Default Duration | Icon | Use Case |
|---------|-----------------|------|----------|
| `default` | 5000ms | None | General information |
| `success` | 3000ms | Check | Successful operations |
| `error` | 8000ms | X | Failed operations |
| `loading` | No auto-dismiss | Spinner | Ongoing operations |

## Migration Guide

```typescript
// Before (incorrect)
showToast(`Connector "${name}" added`, "success")

// After (correct)
showToast({
  title: `Connector "${name}" added`,
  variant: "success"
})

// Before (incorrect)
showToast(error.message, "error")

// After (correct)
showToast({
  title: "Operation failed",
  description: error.message,
  variant: "error"
})
```

## Notes

- Always use single argument (string or options object)
- Use `title` for primary message, `description` for details
- Match `variant` to the semantic meaning of the notification
- Consider using `persistent: true` for critical errors users shouldn't miss
