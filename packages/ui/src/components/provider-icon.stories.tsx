import { For } from "solid-js"
import { iconNames } from "./provider-icons/types"
import { ProviderIcon } from "./provider-icon"

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

export default {
  title: "UI/ProviderIcon",
  id: "components-provider-icon",
  component: ProviderIcon,
  args: { id: "openai" },
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
      options: [...iconNames, "unknown-provider"],
    },
  },
}

export const Basic = {}

export const AllIcons = {
  render: (args: { id: string }) => (
    <div
      style={{
        display: "grid",
        gap: "12px",
        "grid-template-columns": "repeat(auto-fill, minmax(80px, 1fr))",
      }}
    >
      <For each={[...iconNames, "unknown-provider"]}>
        {(id) => (
          <div
            classList={{ "font-bold": args.id === id }}
            style={{ display: "grid", gap: "6px", "justify-items": "center" }}
          >
            <ProviderIcon id={id} width="28" height="28" aria-label={id} />
            <div style={{ "font-size": "10px", color: "var(--text-weak)", "text-align": "center" }}>{id}</div>
          </div>
        )}
      </For>
    </div>
  ),
}

export const Fallback = { args: { id: "unknown-provider" } }
