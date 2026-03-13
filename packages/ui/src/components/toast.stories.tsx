// @ts-nocheck
import * as mod from "./toast"
import { Button } from "./button"

const docs = `### Overview
Toast notifications with optional icons, actions, and progress.

Use brief titles/descriptions; limit actions to 1-2.

### API
- Use \`showToast\` or \`showPromiseToast\` to trigger toasts.
- Render \`Toast.Region\` once per page.
- \`Toast\` subcomponents compose the structure.

### Variants and states
- Variants: default, success, error, loading.
- Optional actions and persistent toasts.

### Behavior
- Toasts render in a portal and auto-dismiss unless persistent.

### Accessibility
- TODO: confirm aria-live behavior from Kobalte Toast.

### Theming/tokens
- Uses \`data-component="toast"\` and slot data attributes.

`

export default {
  title: "UI/Toast",
  id: "components-toast",
  component: mod.Toast,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
}

export const Basic = {
  render: () => (
    <div style={{ display: "grid", gap: "12px" }}>
      <mod.Toast.Region />
      <Button
        variant="primary"
        onClick={() =>
          mod.showToast({
            title: "Saved",
            description: "Your changes are stored.",
            variant: "success",
            icon: "check",
          })
        }
      >
        Show success toast
      </Button>
      <Button
        variant="secondary"
        onClick={() =>
          mod.showToast({
            description: "This action needs attention.",
            variant: "error",
            icon: "warning",
          })
        }
      >
        Show error toast
      </Button>
    </div>
  ),
}

export const Actions = {
  render: () => (
    <div style={{ display: "grid", gap: "12px" }}>
      <mod.Toast.Region />
      <Button
        variant="secondary"
        onClick={() =>
          mod.showToast({
            title: "Update available",
            description: "Restart to apply the update.",
            actions: [
              { label: "Restart", onClick: "dismiss" },
              { label: "Later", onClick: "dismiss" },
            ],
          })
        }
      >
        Show action toast
      </Button>
    </div>
  ),
}

export const Promise = {
  render: () => (
    <div style={{ display: "grid", gap: "12px" }}>
      <mod.Toast.Region />
      <Button
        variant="secondary"
        onClick={() =>
          mod.showPromiseToast(() => new Promise((resolve) => setTimeout(() => resolve(true), 800)), {
            loading: "Saving...",
            success: () => "Saved",
            error: () => "Failed",
          })
        }
      >
        Show promise toast
      </Button>
    </div>
  ),
}

export const Loading = {
  render: () => (
    <div style={{ display: "grid", gap: "12px" }}>
      <mod.Toast.Region />
      <Button
        variant="secondary"
        onClick={() =>
          mod.showToast({
            description: "Syncing...",
            variant: "loading",
            persistent: true,
          })
        }
      >
        Show loading toast
      </Button>
    </div>
  ),
}
