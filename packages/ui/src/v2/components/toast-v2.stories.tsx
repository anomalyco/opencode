import * as mod from "./toast-v2"
import { ButtonV2 } from "./button-v2"

const docs = `### Overview
Toast notifications with optional icons, actions, and progress.

Use brief titles/descriptions; limit actions to 1-2.

### API
- Use \`showToastV2\` or \`showPromiseToastV2\` to trigger toasts.
- Render \`ToastV2.Region\` once per page.
- \`ToastV2\` subcomponents compose the structure.

### Styling and states
- Single toast style; provide any custom icon element via \`icon\`.
- Optional actions and persistent toasts.

### Behavior
- Toasts render in a portal and auto-dismiss unless persistent.

### Accessibility
- TODO: confirm aria-live behavior from Kobalte Toast.

### Theming/tokens
- Uses \`data-component="toast-v2"\` and slot data attributes.

`

export default {
  title: "UI V2/Toast",
  id: "components-toast-v2",
  component: mod.ToastV2,
  tags: ["autodocs"],
  parameters: {
    frameHeight: "320px",
    frameBackground: "#fff",
    docs: {
      description: {
        component: docs,
      },
    },
  },
}

export const AllExamples = {
  render: () => (
    <div style={{ display: "grid", gap: "12px" }}>
      <mod.ToastV2.Region />
      <ButtonV2
        class="w-fit"
        variant="neutral"
        onClick={() =>
          mod.showToastV2({
            title: "Download started...",
            description: "23% · 2 min left",
            icon: (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M13.5554 10.4453V13.5564H11.7777H4.22211C3.23989 13.5564 2.44434 13.5564 2.44434 13.5564V10.4453"
                  stroke="var(--icon-icon-base)"
                />
                <path d="M4.88867 6L7.99978 9.11111L11.1109 6" stroke="var(--icon-icon-base)" />
                <path d="M8 9.11198V2.44531" stroke="var(--icon-icon-base)" />
              </svg>
            ),
            actions: [
              {
                label: "Run in background",
                variant: "primary",
                onClick: "dismiss",
              },
              { label: "Cancel", variant: "secondary", onClick: "dismiss" },
            ],
          })
        }
      >
        Show download toast
      </ButtonV2>
      <ButtonV2
        class="w-fit"
        variant="neutral"
        onClick={() =>
          mod.showToastV2({
            title: "Saved",
            description: "Your changes are stored",
            icon: (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M8.00011 14.4436C11.5593 14.4436 14.4446 11.5583 14.4446 7.99913C14.4446 4.43996 11.5593 1.55469 8.00011 1.55469C4.44094 1.55469 1.55566 4.43996 1.55566 7.99913C1.55566 11.5583 4.44094 14.4436 8.00011 14.4436Z"
                  stroke="#198B43"
                />
                <path d="M5.11133 8.22135L7.11133 10.4436L10.8891 5.55469" stroke="#198B43" />
              </svg>
            ),
          })
        }
      >
        Show saved toast
      </ButtonV2>
      <ButtonV2
        class="w-fit"
        variant="neutral"
        onClick={() =>
          mod.showToastV2({
            title: "Saving...",
            icon: (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="8.75" y="5.25" width="2" height="2" fill="#3A3A3A" />
                <rect x="8.75" y="8.75" width="2" height="2" fill="#3A3A3A" />
                <rect x="8.75" y="12.25" width="2" height="2" fill="#3A3A3A" />
                <rect x="5.25" y="12.25" width="2" height="2" fill="#3A3A3A" />
                <rect opacity="0.3" x="5.25" y="1.75" width="2" height="2" fill="#3A3A3A" />
                <rect opacity="0.3" x="5.25" y="5.25" width="2" height="2" fill="#3A3A3A" />
                <rect opacity="0.3" x="5.25" y="8.75" width="2" height="2" fill="#3A3A3A" />
                <rect opacity="0.3" x="8.75" y="1.75" width="2" height="2" fill="#3A3A3A" />
              </svg>
            ),
            persistent: true,
          })
        }
      >
        Show saving toast
      </ButtonV2>
      <ButtonV2
        class="w-fit"
        variant="neutral"
        onClick={() =>
          mod.showToastV2({
            title: "Unsaved changes",
            description: "You have made 4 edits...",
            icon: (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M8 6.33334V8.99392M7.78099 10.9934H8.23448M8 2L1.5 13H14.5L8 2Z"
                  stroke="#CB9F34"
                  stroke-linecap="square"
                />
              </svg>
            ),
            actions: [
              { label: "Save changes", variant: "primary", onClick: "dismiss" },
              { label: "Cancel", variant: "secondary", onClick: "dismiss" },
            ],
          })
        }
      >
        Show unsaved changes toast
      </ButtonV2>
    </div>
  ),
}
