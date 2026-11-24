import { Badge, type BadgeProps } from "./badge"

type Args = Pick<BadgeProps, "appearance" | "variant"> & { children: string; highContrast: boolean }

const docs = `### Overview
Small inline label for metadata and status chips alongside headings or lists. Give it meaningful text as well as a color.

### API and states
Badge accepts native span props. Compact (16px) uses tabular numeric text; standard (18px) is roomier.
Choose neutral, accent, subtle (borderless, for counts), or danger. The data-high-contrast attribute strengthens the compact neutral border.

### Theming
Uses data-component="tag".`

function Preview(args: Args) {
  return (
    <Badge appearance={args.appearance} variant={args.variant} data-high-contrast={args.highContrast ? "" : undefined}>
      {args.children}
    </Badge>
  )
}

export default {
  title: "UI/Badge",
  id: "ui-badge",
  component: Badge,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: docs } } },
  args: { children: "Label", appearance: "compact", variant: "neutral", highContrast: false } satisfies Args,
  argTypes: {
    appearance: { control: "select", options: ["compact", "standard"] satisfies BadgeProps["appearance"][] },
    variant: {
      control: "select",
      options: ["neutral", "accent", "subtle", "danger"] satisfies BadgeProps["variant"][],
    },
  },
  render: Preview,
}

export const Basic = {}

export const Appearances = {
  render: (args: Args) => (
    <div class="flex items-center gap-2">
      <Preview {...args} appearance="standard">
        Standard
      </Preview>
      <Preview {...args} appearance="compact">
        Compact
      </Preview>
    </div>
  ),
}

export const Subtle = {
  args: { variant: "subtle", children: "12" },
  render: (args: Args) => (
    <div class="flex items-center gap-2">
      <Preview {...args}>1</Preview>
      <Preview {...args} />
    </div>
  ),
}

export const HighContrast = {
  args: { highContrast: true },
  render: (args: Args) => (
    <div class="flex items-center gap-2">
      <Preview {...args} highContrast={false} />
      <Preview {...args} />
    </div>
  ),
}

export const Accent = { args: { variant: "accent", children: "New" } }
