import { Card, CardActions, CardDescription, CardTitle, type CardProps } from "./card"
import { Button } from "@opencode/ui/button"

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
    icon: "auto",
    title: "Card title",
    description: "Small supporting text.",
  },
  argTypes: {
    icon: { control: "select", options: ["auto", "none", "check"] },
    variant: {
      control: "select",
      options: ["normal", "error", "warning", "success", "info"],
    },
  },
  render: (props: {
    variant: CardProps["variant"]
    icon: "auto" | "none" | "check"
    title: string
    description: string
  }) => {
    return (
      <Card variant={props.variant}>
        <CardTitle
          variant={props.variant}
          icon={props.icon === "auto" ? undefined : props.icon === "none" ? false : props.icon}
        >
          {props.title}
        </CardTitle>
        <CardDescription>{props.description}</CardDescription>
        <CardActions>
          <Button size="small" variant="neutral">
            Action
          </Button>
        </CardActions>
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
