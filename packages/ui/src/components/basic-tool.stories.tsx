// @ts-nocheck
import { createSignal } from "solid-js"
import * as mod from "./basic-tool"
import { create } from "../storybook/scaffold"

const docs = `### Overview
Tool call surface with explicit row and panel variants.

Use structured triggers for consistent layout; custom triggers allowed.

### API
- Required: \`variant\`, \`icon\`, and \`trigger\`.
- Row tools render summary-only.
- Panel/group tools support \`defaultOpen\`, \`forceOpen\`, \`defer\`, and \`locked\`.

### Variants and states
- Pending/running status animates the title via TextShimmer.

### Behavior
- Row tools skip collapsible state and render lightweight trigger-only markup.
- Panel/group tools use Collapsible and can defer content rendering until open.
- Locked state prevents closing.

### Accessibility
- TODO: confirm trigger semantics and aria labeling.

### Theming/tokens
- Uses \`data-component="tool-trigger"\` and related slots.

`

const story = create({
  title: "UI/Tool Call",
  mod,
  name: "ToolCall",
  args: {
    variant: "panel",
    icon: "mcp",
    defaultOpen: true,
    trigger: {
      title: "Tool Call",
      subtitle: "Example subtitle",
      args: ["--flag", "value"],
    },
    children: "Details content",
  },
})

export default {
  title: "UI/Tool Call",
  id: "components-tool-call",
  component: story.meta.component,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
}

export const Basic = story.Basic

export const Pending = {
  args: {
    variant: "panel",
    status: "pending",
    trigger: {
      title: "Running tool",
      subtitle: "Working...",
    },
    children: "Progress details",
  },
}

export const Locked = {
  args: {
    variant: "panel",
    locked: true,
    trigger: {
      title: "Locked tool",
      subtitle: "Cannot close",
    },
    children: "Locked details",
  },
}

export const Deferred = {
  args: {
    variant: "panel",
    defer: true,
    defaultOpen: false,
    trigger: {
      title: "Deferred tool",
      subtitle: "Content mounts on open",
    },
    children: "Deferred content",
  },
}

export const ForceOpen = {
  args: {
    variant: "panel",
    forceOpen: true,
    trigger: {
      title: "Forced open",
      subtitle: "Cannot close",
    },
    children: "Forced content",
  },
}

export const Row = {
  args: {
    variant: "row",
    icon: "mcp",
    trigger: {
      title: "Summary only",
      subtitle: "Lightweight row",
    },
  },
}

export const SubtitleAction = {
  render: () => {
    const [message, setMessage] = createSignal("Subtitle not clicked")
    return (
      <div style={{ display: "grid", gap: "8px" }}>
        <div style={{ "font-size": "12px", color: "var(--text-weak)" }}>{message()}</div>
        <mod.ToolCall
          variant="panel"
          icon="mcp"
          trigger={{ title: "Clickable subtitle", subtitle: "Click me" }}
          onSubtitleClick={() => setMessage("Subtitle clicked")}
        >
          Subtitle action details
        </mod.ToolCall>
      </div>
    )
  },
}
