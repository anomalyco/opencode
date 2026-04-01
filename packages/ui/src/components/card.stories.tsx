// @ts-nocheck
import { Card } from "./card"
import { Button } from "./button"

const docs = `### Overview
Surface container for grouping related content and actions.

Pair with \`Button\` or \`Tag\` for quick actions.

### API
- Optional: \`variant\` (normal, error, warning, success, info).
- Accepts standard div props.

### Variants and states
- Semantic variants for status-driven messaging.

### Behavior
- Pure presentational container.

### Accessibility
- Provide headings or aria labels when used in isolation.

### Theming/tokens
- Uses \`data-component="card"\` with variant data attributes.

`

export default {
  title: "UI/Card",
  id: "components-card",
  component: Card,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
  args: {
    variant: "normal",
  },
  argTypes: {
    variant: {
      control: "select",
      options: ["normal", "error", "warning", "success", "info"],
    },
  },
  render: (props: { variant?: "normal" | "error" | "warning" | "success" | "info" }) => {
    return (
      <Card variant={props.variant}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 500 }}>Card title</div>
            <div style={{ color: "var(--text-weak)", fontSize: "13px" }}>Small supporting text.</div>
          </div>
          <Button size="small" variant="ghost">
            Action
          </Button>
        </div>
      </Card>
    )
  },
}

export const Normal = {}

export const Error = {
  args: {
    variant: "error",
  },
}

export const Warning = {
  args: {
    variant: "warning",
  },
}

export const Success = {
  args: {
    variant: "success",
  },
}

export const Info = {
  args: {
    variant: "info",
  },
}
