import { IconButtonV2 } from "./icon-button-v2"

const docs = `### Overview
Square icon-only button v2 with three visual variants and three sizes.

### API
- \`icon\`: Icon name from the icon component.
- \`variant\`: "neutral" | "contrast" | "ghost".
- \`size\`: "small" | "normal" | "large".
- \`iconSize\`: Optional explicit icon size override.
- Inherits Kobalte Button props and native button attributes.

### States
- default, hover, pressed, focus, disabled.
- State selectors are available via pseudo-classes and \`[data-state]\`.
`

export default {
  title: "UI V2/IconButton",
  id: "components-icon-button-v2",
  component: IconButtonV2,
  tags: ["autodocs"],
  parameters: {
    frameHeight: "300px",
    frameBackground: "#fff",
    docs: {
      description: {
        component: docs,
      },
    },
  },
  args: {
    icon: "plus",
    variant: "neutral",
    size: "normal",
  },
  argTypes: {
    icon: {
      control: "text",
    },
    variant: {
      control: "select",
      options: ["neutral", "contrast", "ghost"],
    },
    size: {
      control: "select",
      options: ["small", "normal", "large"],
    },
    iconSize: {
      control: "select",
      options: ["small", "normal", "large"],
    },
  },
}

export const Playground = {}

export const Variants = {
  render: () => (
    <div style={{ display: "flex", gap: "12px", "align-items": "center", "flex-wrap": "wrap" }}>
      <IconButtonV2 icon="plus" variant="neutral" />
      <IconButtonV2 icon="plus" variant="contrast" />
      <IconButtonV2 icon="plus" variant="ghost" />
    </div>
  ),
}

export const Sizes = {
  render: () => (
    <div style={{ display: "flex", gap: "12px", "align-items": "center", "flex-wrap": "wrap" }}>
      <IconButtonV2 icon="plus" size="small" variant="neutral" />
      <IconButtonV2 icon="plus" size="normal" variant="neutral" />
      <IconButtonV2 icon="plus" size="large" variant="neutral" />
    </div>
  ),
}

export const AllStates = {
  render: () => {
    const variants = ["neutral", "contrast", "ghost"] as const
    const states = ["default", "hover", "pressed", "focus", "disabled"] as const

    return (
      <div style={{ display: "grid", gap: "12px" }}>
        {variants.map((variant) => (
          <div style={{ display: "grid", gap: "8px" }}>
            <div style={{ "font-size": "12px", color: "var(--text-weak)", "text-transform": "capitalize" }}>
              {variant}
            </div>
            <div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}>
              {states.map((state) => (
                <IconButtonV2
                  icon="plus"
                  variant={variant}
                  data-state={state === "default" ? undefined : state}
                  disabled={state === "disabled"}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  },
}
