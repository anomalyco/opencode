import { ButtonV2 } from "./button-v2"

const docs = `### Overview
Button v2 with three visual variants and two sizes.

### API
- \`variant\`: "neutral" | "contrast" | "ghost".
- \`size\`: "normal" | "large".
- \`icon\`: Optional icon name.
- Inherits Kobalte Button props and native button attributes.

### States
- default, hover, pressed, focus, disabled.
- State selectors are available via pseudo-classes and \`[data-state]\`.
`

export default {
  title: "UI V2/Button",
  id: "components-button-v2",
  component: ButtonV2,
  tags: ["autodocs"],
  parameters: {
    frameHeight: "240px",
    frameBackground: "#fff",
    docs: {
      description: {
        component: docs,
      },
    },
  },
  args: {
    children: "Button",
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
      options: ["normal", "large"],
    },
  },
}

export const Playground = {}

export const Variants = {
  render: () => (
    <div
      style={{
        display: "flex",
        gap: "12px",
        "align-items": "center",
        "flex-wrap": "wrap",
      }}
    >
      <ButtonV2 variant="neutral">Neutral</ButtonV2>
      <ButtonV2 variant="contrast">Contrast</ButtonV2>
      <ButtonV2 variant="ghost">Ghost</ButtonV2>
    </div>
  ),
}

export const Sizes = {
  render: () => (
    <div
      style={{
        display: "flex",
        gap: "12px",
        "align-items": "center",
        "flex-wrap": "wrap",
      }}
    >
      <ButtonV2 size="small" variant="neutral">
        Small
      </ButtonV2>
      <ButtonV2 size="normal" variant="neutral">
        Normal
      </ButtonV2>
      <ButtonV2 size="large" variant="neutral">
        Large
      </ButtonV2>
    </div>
  ),
}

export const Icon = {
  render: () => (
    <div
      style={{
        display: "flex",
        gap: "12px",
        "align-items": "center",
        "flex-wrap": "wrap",
      }}
    >
      <ButtonV2 variant="neutral" size="normal" icon="plus">
        Normal
      </ButtonV2>
      <ButtonV2 variant="contrast" size="large" icon="plus">
        Large
      </ButtonV2>
    </div>
  ),
}

export const AllStates = {
  render: () => {
    const variants = ["neutral", "contrast", "ghost"] as const
    const states = ["default", "hover", "pressed", "focus", "disabled"] as const
    const toTitleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)
    return (
      <div style={{ display: "grid", gap: "12px" }}>
        {variants.map((variant) => (
          <div style={{ display: "grid", gap: "8px" }}>
            <div
              style={{
                "font-size": "12px",
                color: "var(--text-weak)",
                "text-transform": "capitalize",
              }}
            >
              {variant}
            </div>
            <div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}>
              {states.map((state) => (
                <ButtonV2
                  variant={variant}
                  data-state={state === "default" ? undefined : state}
                  disabled={state === "disabled"}
                >
                  {toTitleCase(state)}
                </ButtonV2>
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  },
}
