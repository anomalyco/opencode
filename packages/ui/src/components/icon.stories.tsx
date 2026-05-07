// @ts-nocheck
import * as mod from "./icon"
import { create } from "../storybook/scaffold"

const docs = `### Overview
Inline icon renderer using the built-in OpenCode icon set.

Use with \`Button\`, \`IconButton\`, and menu items.

### API
- Required: \`name\` (icon key).
- Optional: \`size\` (small | normal | medium | large).
- Accepts standard SVG props.

### Variants and states
- Size variants only.

### Behavior
- Uses an internal SVG path map.

### Accessibility
- Icons are aria-hidden by default; wrap with accessible text when needed.

### Theming/tokens
- Uses \`data-component="icon"\` with size data attributes.

`

const names = [
  "align-right",
  "arrow-up",
  "arrow-left",
  "arrow-right",
  "archive",
  "bubble-5",
  "prompt",
  "brain",
  "bullet-list",
  "check-small",
  "chevron-down",
  "chevron-left",
  "chevron-right",
  "chevron-grabber-vertical",
  "chevron-double-right",
  "circle-x",
  "close",
  "close-small",
  "checklist",
  "console",
  "expand",
  "collapse",
  "code",
  "code-lines",
  "circle-ban-sign",
  "edit-small-2",
  "eye",
  "enter",
  "folder",
  "file-tree",
  "file-tree-active",
  "magnifying-glass",
  "plus-small",
  "plus",
  "new-session",
  "pencil-line",
  "mcp",
  "glasses",
  "magnifying-glass-menu",
  "window-cursor",
  "task",
  "stop",
  "layout-left",
  "layout-left-partial",
  "layout-left-full",
  "layout-right",
  "layout-right-partial",
  "layout-right-full",
  "square-arrow-top-right",
  "open-file",
  "speech-bubble",
  "comment",
  "folder-add-left",
  "github",
  "discord",
  "layout-bottom",
  "layout-bottom-partial",
  "layout-bottom-full",
  "dot-grid",
  "circle-check",
  "copy",
  "check",
  "photo",
  "share",
  "download",
  "menu",
  "server",
  "branch",
  "edit",
  "help",
  "settings-gear",
  "dash",
  "cloud-upload",
  "trash",
  "sliders",
  "keyboard",
  "selector",
  "arrow-down-to-line",
  "warning",
  "link",
  "providers",
  "models",
]

const story = create({ title: "UI/Icon", mod, args: { name: "check" } })

export default {
  title: "UI/Icon",
  id: "components-icon",
  component: story.meta.component,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
  argTypes: {
    name: {
      control: "select",
      options: names,
    },
    size: {
      control: "select",
      options: ["small", "normal", "medium", "large"],
    },
  },
}

export const Basic = story.Basic

export const Sizes = {
  render: () => (
    <div style={{ display: "flex", gap: "12px", "align-items": "center" }}>
      <mod.Icon name="check" size="small" />
      <mod.Icon name="check" size="normal" />
      <mod.Icon name="check" size="medium" />
      <mod.Icon name="check" size="large" />
    </div>
  ),
}

export const Gallery = {
  render: () => (
    <div
      style={{
        display: "grid",
        gap: "12px",
        "grid-template-columns": "repeat(auto-fill, minmax(88px, 1fr))",
      }}
    >
      {names.map((name) => (
        <div style={{ display: "grid", gap: "6px", "justify-items": "center" }}>
          <mod.Icon name={name} />
          <div style={{ "font-size": "10px", color: "var(--text-weak)", "text-align": "center" }}>{name}</div>
        </div>
      ))}
    </div>
  ),
}
