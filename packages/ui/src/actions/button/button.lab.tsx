import { For } from "solid-js"
import { iconNames } from "@opencode/ui/icons/catalog"
import { Button, type ButtonProps } from "./button"

type Args = Pick<ButtonProps, "variant" | "size" | "disabled"> & {
  children: string
  icon: string
  interaction: "rest" | "hover" | "pressed" | "focus"
  expanded: boolean
}

const variants = [
  "neutral",
  "danger",
  "warning",
  "outline",
  "contrast",
  "submit",
  "ghost",
  "ghost-muted",
  "ghost-faint",
  "ghost-danger",
  "loading",
] satisfies ButtonProps["variant"][]

const sizes = ["small", "normal", "large"] satisfies ButtonProps["size"][]

const interactions = ["rest", "hover", "pressed", "focus"] as const

const label = (value: string) => value[0].toUpperCase() + value.slice(1).replaceAll("-", " ")

const docs = `### Overview
Button v2 with visual variants and three sizes.

### API
- \`variant\`: ${variants.join(", ")}. Submit shares the brighter contrast icon-button styling for Composer submission actions.
- \`size\`: small, normal or large.
- \`icon\`: Optional icon name.
- Inherits native button attributes.

### States
Default, hover, pressed, focus and disabled. Try the pointer and keyboard, or pin an interaction in the panel.
Expanded styles apply to ghost, ghost-muted and ghost-faint buttons.`

function Preview(args: Args) {
  return (
    <Button
      variant={args.variant}
      size={args.size}
      icon={args.icon === "none" ? undefined : args.icon}
      disabled={args.disabled}
      data-state={args.interaction}
      data-expanded={args.expanded ? "" : undefined}
    >
      {args.children}
    </Button>
  )
}

export default {
  title: "UI/Button",
  id: "ui-button",
  component: Button,
  tags: ["autodocs"],
  parameters: {
    frameHeight: "240px",
    frameBackground: "#fff",
    docs: { description: { component: docs } },
  },
  args: {
    children: "Button",
    variant: "neutral",
    size: "normal",
    icon: "none",
    interaction: "rest",
    disabled: false,
    expanded: false,
  } satisfies Args,
  argTypes: {
    variant: { control: "select", options: variants },
    size: { control: "select", options: sizes },
    icon: { control: "select", options: ["none", ...iconNames().sort()] },
    interaction: { control: "select", options: interactions },
  },
  render: Preview,
}

export const Playground = {}

export const Variants = {
  render: (args: Args) => (
    <div class="flex flex-wrap items-center gap-3">
      <For each={variants}>
        {(variant) => (
          <Preview
            {...args}
            variant={variant}
            icon={args.icon === "none" && (variant === "ghost-muted" || variant === "ghost-faint") ? "edit" : args.icon}
          >
            {label(variant)}
          </Preview>
        )}
      </For>
    </div>
  ),
}

export const Sizes = {
  render: (args: Args) => (
    <div class="flex flex-wrap items-center gap-3">
      <For each={sizes}>
        {(size) => (
          <Preview {...args} size={size}>
            {label(size)}
          </Preview>
        )}
      </For>
    </div>
  ),
}

export const Icon = {
  args: { icon: "plus" },
  render: (args: Args) => (
    <div class="flex flex-wrap items-center gap-3">
      <Preview {...args}>Normal</Preview>
      <Preview {...args} variant="contrast" size="large">
        Large
      </Preview>
    </div>
  ),
}

export const AllStates = {
  render: (args: Args) => (
    <div class="grid gap-3">
      <For each={variants}>
        {(variant) => (
          <div class="grid gap-2">
            <div class="text-xs text-text-weak capitalize">{variant}</div>
            <div class="flex flex-wrap gap-2">
              <For each={interactions}>
                {(interaction) => (
                  <Preview {...args} variant={variant} interaction={interaction}>
                    {interaction === "rest" ? "Default" : label(interaction)}
                  </Preview>
                )}
              </For>
              <Preview {...args} variant={variant} disabled>
                Disabled
              </Preview>
            </div>
          </div>
        )}
      </For>
    </div>
  ),
}
