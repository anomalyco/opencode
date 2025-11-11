# Dialog System Usage

The openTUI web dialog system provides styled notification dialogs matching the terminal aesthetic.

## StyledDialog Component

A styled dialog with two variants: `info` (blue) and `error` (red).

### Props

```typescript
interface StyledDialogProps {
  variant?: "info" | "error" // Default: "info"
  title?: string // Optional custom title
  message: string // Main message text
  actionLabel?: string // Button text (optional)
  onAction?: () => void // Button click handler (optional)
  onClose: () => void // Close handler (ESC or backdrop click)
  isOpen: boolean // Controls visibility
}
```

### Styling

- **Info variant**: Blue background (#61afef), white text
- **Error variant**: Red background (#e06c75), white text
- **Font**: Berkeley Mono at 16px
- **Button**: White background with variant color text
- **Overlay**: Dark backdrop (80% opacity)
- **Keyboard**: ESC key to close

### Example Usage

```tsx
import { createSignal } from "solid-js"
import { StyledDialog } from "@opencode-ai/opentui-web"

function MyComponent() {
  const [dialogOpen, setDialogOpen] = createSignal(false)

  return (
    <>
      <button onClick={() => setDialogOpen(true)}>Show Dialog</button>

      <StyledDialog
        variant="info"
        message="Tokens exceed context window (200,000). Creating new chat."
        actionLabel="Continue in new chat"
        onAction={() => {
          // Handle action
          console.log("User clicked action button")
          setDialogOpen(false)
        }}
        onClose={() => setDialogOpen(false)}
        isOpen={dialogOpen()}
      />
    </>
  )
}
```

### Info Dialog Example

```tsx
<StyledDialog
  variant="info"
  message="Tokens exceed context window (200,000). Creating new chat."
  actionLabel="Continue in new chat"
  onAction={() => createNewChat()}
  onClose={() => setOpen(false)}
  isOpen={open()}
/>
```

### Error Dialog Example

```tsx
<StyledDialog
  variant="error"
  message="Failed to connect to server. Please check your connection."
  actionLabel="Retry"
  onAction={() => retryConnection()}
  onClose={() => setOpen(false)}
  isOpen={open()}
/>
```

### Without Action Button

You can also create dialogs without action buttons (info-only):

```tsx
<StyledDialog
  variant="info"
  message="Processing complete. 50 files updated."
  onClose={() => setOpen(false)}
  isOpen={open()}
/>
```

## Legacy Dialog Component

The original `Dialog` component is still available for custom content:

```tsx
<Dialog title="Custom Dialog" isOpen={open()} onClose={() => setOpen(false)}>
  <div>Your custom content here</div>
</Dialog>
```

## Demo

Run the demo to see both variants in action:

```bash
cd packages/opentui-web
bun run dev
```

Then navigate to the DialogDemo example in `src/examples/DialogDemo.tsx`.
