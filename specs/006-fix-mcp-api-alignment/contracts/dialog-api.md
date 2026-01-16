# Contract: Dialog Component API

**Feature**: 006-fix-mcp-api-alignment
**Component**: Dialog (`@opencode-ai/ui`)

## Interface

```typescript
export interface DialogProps extends ParentProps {
  title?: JSXElement
  description?: JSXElement
  action?: JSXElement
  class?: ComponentProps<"div">["class"]
  classList?: ComponentProps<"div">["classList"]
}
```

## State Management Hook

```typescript
import { useDialog } from '@opencode-ai/ui/context/dialog'

interface DialogContext {
  show: (content: () => JSXElement) => void
  close: () => void
}
```

## Correct Usage Patterns

### Pattern 1: Confirmation Dialog

```typescript
import { Dialog, Button } from '@opencode-ai/ui'
import { useDialog } from '@opencode-ai/ui/context/dialog'

function MyComponent() {
  const dialog = useDialog()

  function showConfirmation() {
    dialog.show(() => (
      <Dialog
        title="Confirm Action"
        description="Are you sure you want to proceed?"
      >
        <div class="flex gap-2 justify-end mt-4">
          <Button variant="ghost" onClick={dialog.close}>
            Cancel
          </Button>
          <Button onClick={() => { handleConfirm(); dialog.close() }}>
            Confirm
          </Button>
        </div>
      </Dialog>
    ))
  }
}
```

### Pattern 2: Form Dialog

```typescript
function showFormDialog() {
  dialog.show(() => (
    <Dialog
      title="Edit Item"
      description="Update the item details below"
    >
      <form onSubmit={handleSubmit} class="space-y-4">
        <TextField label="Name" value={name()} onInput={setName} />
        <TextField label="Value" value={value()} onInput={setValue} />

        <div class="flex gap-2 justify-end mt-4">
          <Button variant="ghost" onClick={dialog.close}>
            Cancel
          </Button>
          <Button type="submit">
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  ))
}
```

## Incorrect Usage (Do NOT Use)

```typescript
// ❌ WRONG: Compound component pattern
<Dialog open={open} onOpenChange={setOpen}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>Title</Dialog.Title>
    </Dialog.Header>
    <Dialog.Footer>
      <Button>OK</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog>

// ❌ WRONG: Using open/onOpenChange props
<Dialog open={isOpen()} onOpenChange={setIsOpen}>
  ...
</Dialog>
```

## Key Differences from Common Libraries

| Feature | This Project | Radix/Kobalte |
|---------|-------------|---------------|
| State management | useDialog() hook | open/onOpenChange props |
| Content wrapper | None (direct children) | Dialog.Content |
| Title | `title` prop | Dialog.Title component |
| Description | `description` prop | Dialog.Description component |
| Footer | Manual div | Dialog.Footer component |

## Notes

- Dialog content is passed as children
- Buttons should be placed in a flex container at the bottom
- The `action` prop is optional and can be used for primary action buttons
- Close functionality is handled via `dialog.close()` from the hook
