import { createEffect, For } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { iconNames } from "@opencode/ui/icons/catalog"
import { IconButton, type IconButtonProps } from "./icon-button"

type Args = Pick<IconButtonProps, "variant" | "size" | "disabled"> & {
  icon: string
  interaction: NonNullable<IconButtonProps["state"]> | "focus"
  expanded: boolean
}

const variants = ["neutral", "contrast", "submit", "ghost", "ghost-muted"] satisfies IconButtonProps["variant"][]

const sizes = ["small", "normal", "large"] satisfies IconButtonProps["size"][]

const interactions = ["rest", "hover", "pressed", "focus"] as const

const docs = `### Overview
Square icon-only button with visual variants and three sizes.

### API
- \`icon\`: Icon content. Choose a glyph in the panel.
- \`variant\`: ${variants.join(", ")}. Submit shares the contrast styling with Composer submit buttons.
- \`size\`: small, normal or large.
- Inherits native button attributes.

### States
Default, hover, pressed, keyboard focus and disabled. The state prop pins hover or pressed styling.
Expanded styles apply to the ghost variants.`

function Preview(args: Args) {
  return (
    <IconButton
      aria-label={args.icon}
      icon={<Icon name={args.icon} />}
      variant={args.variant}
      size={args.size}
      state={args.interaction === "focus" ? undefined : args.interaction}
      ref={(button) =>
        createEffect(() => {
          // CSS supports a pinned focus ring in addition to the public rest/hover/pressed prop.
          if (args.interaction === "focus") button.dataset.state = "focus"
        })
      }
      disabled={args.disabled}
      data-expanded={args.expanded ? "" : undefined}
    />
  )
}

export default {
  title: "UI/IconButton",
  id: "ui-icon-button",
  component: IconButton,
  tags: ["autodocs"],
  parameters: {
    frameHeight: "300px",
    frameBackground: "#fff",
    docs: { description: { component: docs } },
  },
  args: {
    icon: "plus",
    variant: "neutral",
    size: "normal",
    interaction: "rest",
    disabled: false,
    expanded: false,
  } satisfies Args,
  argTypes: {
    icon: { control: "select", options: iconNames().sort() },
    variant: { control: "select", options: variants },
    size: { control: "select", options: sizes },
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
            icon={variant === "submit" && args.icon === "plus" ? "arrow-up" : args.icon}
          />
        )}
      </For>
    </div>
  ),
}

export const Sizes = {
  render: (args: Args) => (
    <div class="flex flex-wrap items-center gap-3">
      <For each={sizes}>{(size) => <Preview {...args} size={size} />}</For>
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
                {(interaction) => <Preview {...args} interaction={interaction} variant={variant} />}
              </For>
              <Preview {...args} variant={variant} disabled />
            </div>
          </div>
        )}
      </For>
    </div>
  ),
}
