// @ts-nocheck
import { iconNames } from "./provider-icons/types"
import * as mod from "./provider-icon"
import { create } from "../storybook/scaffold"

const docs = `### Overview
Provider icon sprite renderer for model/provider badges.

Use in model pickers or provider lists.

### API
- Required: \`id\` (provider icon name).
- Accepts standard SVG props.

### Variants and states
- Single visual style; size via CSS.

### Behavior
- Renders from the provider SVG sprite sheet.

### Accessibility
- Provide accessible text nearby when the icon conveys meaning.

### Theming/tokens
- Uses \`data-component="provider-icon"\`.

`

const story = create({ title: "UI/ProviderIcon", mod, args: { id: "openai" } })
export default {
  title: "UI/ProviderIcon",
  id: "components-provider-icon",
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
    id: {
      control: "select",
      options: [...iconNames, "kimi-code-plan-cn", "kimi-code-plan-global"],
    },
  },
}

export const Basic = story.Basic

export const KimiProviders = {
  render: () => (
    <div style={{ display: "flex", gap: "24px", "align-items": "start" }}>
      {["kimi-code-plan-cn", "kimi-code-plan-global", "kimi-for-coding", "unknown-provider"].map((id) => (
        <div style={{ display: "grid", gap: "12px", "justify-items": "center" }}>
          <mod.ProviderIcon id={id} width="32" height="32" aria-label={id} />
          <code>{id}</code>
        </div>
      ))}
    </div>
  ),
}

export const AllIcons = {
  render: () => (
    <div
      style={{
        display: "grid",
        gap: "12px",
        "grid-template-columns": "repeat(auto-fill, minmax(80px, 1fr))",
      }}
    >
      {iconNames.map((id) => (
        <div style={{ display: "grid", gap: "6px", "justify-items": "center" }}>
          <mod.ProviderIcon id={id} width="28" height="28" aria-label={id} />
          <div style={{ "font-size": "10px", color: "var(--text-weak)", "text-align": "center" }}>{id}</div>
        </div>
      ))}
    </div>
  ),
}
