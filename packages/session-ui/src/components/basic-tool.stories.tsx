// @ts-nocheck
import { createSignal } from "solid-js"
import * as mod from "./basic-tool"
import { create } from "@opencode-ai/ui/storybook/scaffold"

const docs = `### Overview
Expandable tool panel with a structured trigger and optional details.

Use structured triggers for consistent layout; custom triggers allowed.

### API
- Required: \`icon\` and \`trigger\` (structured or custom JSX).
- Optional: \`status\`, \`defaultOpen\`, \`forceOpen\`, \`defer\`, \`locked\`.

### Variants and states
- Pending/running status animates the title via TextShimmer.

### Behavior
- Uses Collapsible; can defer content rendering until open.
- Locked state prevents closing.

### Accessibility
- TODO: confirm trigger semantics and aria labeling.

### Theming/tokens
- Uses \`data-component="tool-trigger"\` and related slots.

`

const story = create({
  title: "UI/Basic Tool",
  mod,
  args: {
    icon: "mcp",
    defaultOpen: true,
    trigger: {
      title: "Basic Tool",
      subtitle: "Example subtitle",
      args: ["--flag", "value"],
    },
    children: "Details content",
  },
})

export default {
  title: "UI/Basic Tool",
  id: "components-basic-tool",
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
    forceOpen: true,
    trigger: {
      title: "Forced open",
      subtitle: "Cannot close",
    },
    children: "Forced content",
  },
}

export const HideDetails = {
  args: {
    hideDetails: true,
    trigger: {
      title: "Summary only",
      subtitle: "Details hidden",
    },
    children: "Hidden content",
  },
}

export const SubtitleAction = {
  render: () => {
    const [message, setMessage] = createSignal("Subtitle not clicked")
    return (
      <div style={{ display: "grid", gap: "8px" }}>
        <div style={{ "font-size": "12px", color: "var(--text-weak)" }}>{message()}</div>
        <mod.BasicTool
          icon="mcp"
          trigger={{ title: "Clickable subtitle", subtitle: "Click me" }}
          onSubtitleClick={() => setMessage("Subtitle clicked")}
        >
          Subtitle action details
        </mod.BasicTool>
      </div>
    )
  },
}

export const RunningElapsed = {
  args: {
    status: "running",
    startedAt: Date.now() - 5000,
    trigger: {
      title: "Running tool",
      subtitle: "Working...",
    },
    children: "Progress details",
  },
}

export const CompletedElapsed = {
  args: {
    status: "completed",
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_003_200,
    trigger: {
      title: "Finished tool",
      subtitle: "Done",
    },
    children: "Result details",
  },
}

// Function triggers (e.g. the shell renderer) bypass the title branch, so
// the badge needs its own slot there. Regression coverage for that path.
// The inline-flex wrapper mirrors the real shell trigger layout so the
// screenshot proves the badge sits inline after the command, not wrapped.
export const FunctionTriggerElapsed = {
  args: {
    status: "running",
    startedAt: Date.now() - 5000,
    trigger: () => (
      <div style={{ display: "inline-flex", "align-items": "center", gap: "8px" }}>
        <span>Shell</span> <span>sleep 10</span>
      </div>
    ),
    children: "Progress details",
  },
}
