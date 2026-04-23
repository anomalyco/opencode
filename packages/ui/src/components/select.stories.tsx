// @ts-nocheck
import * as mod from "./select"
import { create } from "../storybook/scaffold"

const docs = `### Overview
Select menu for choosing a single option with optional grouping.

Use \`children\` to customize option rendering.

### API
- Required: \`options\`.
- Optional: \`current\`, \`placeholder\`, \`value\`, \`label\`, \`groupBy\`.
- Accepts Button props for the trigger (\`variant\`, \`size\`).

### Variants and states
- Trigger supports "settings" style via \`triggerVariant\`.

### Behavior
- Uses Kobalte Select with optional item highlight callbacks.

### Accessibility
- TODO: confirm keyboard navigation and aria attributes from Kobalte.

### Theming/tokens
- Uses \`data-component="select"\` with slot attributes.

`

const story = create({
  title: "UI/Select",
  mod,
  args: {
    options: ["One", "Two", "Three"],
    current: "One",
    placeholder: "Choose...",
    variant: "secondary",
    size: "normal",
  },
})

export default {
  title: "UI/Select",
  id: "components-select",
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
    triggerVariant: {
      control: "select",
      options: ["settings", undefined],
    },
  },
}

export const Basic = story.Basic

export const Grouped = {
  render: () => {
    const options = [
      { id: "alpha", label: "Alpha", group: "Group A" },
      { id: "bravo", label: "Bravo", group: "Group A" },
      { id: "delta", label: "Delta", group: "Group B" },
    ]
    return (
      <mod.Select
        options={options}
        current={options[0]}
        value={(item) => item.id}
        label={(item) => item.label}
        groupBy={(item) => item.group}
        placeholder="Choose..."
        variant="secondary"
      />
    )
  },
}

export const SettingsTrigger = {
  args: {
    triggerVariant: "settings",
  },
}

export const CustomRender = {
  render: () => (
    <mod.Select
      options={["Primary", "Secondary", "Ghost"]}
      current="Primary"
      placeholder="Choose..."
      variant="secondary"
    >
      {(item) => <span style={{ "text-transform": "uppercase" }}>{item}</span>}
    </mod.Select>
  ),
}

export const CustomTriggerStyle = {
  args: {
    triggerStyle: { "min-width": "180px", "justify-content": "space-between" },
  },
}

export const Disabled = {
  args: {
    disabled: true,
  },
}
