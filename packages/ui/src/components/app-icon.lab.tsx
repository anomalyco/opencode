import { For } from "solid-js"
import { iconNames, type IconName } from "./app-icons/types"
import { AppIcon } from "./app-icon"

const docs = `### Overview
Application icon renderer for known editor/terminal apps.

Use in provider or app selection lists.

### API
- Required: \`id\` (app icon name).
- Accepts standard img props except \`src\`.

### Variants and states
- Auto-switches themed icons when available.

### Behavior
- Watches color scheme changes to swap themed assets.

### Accessibility
- Provide \`alt\` text when the icon conveys meaning.

### Theming/tokens
- Uses \`data-component="app-icon"\`.

`

export default {
  title: "UI/AppIcon",
  id: "components-app-icon",
  component: AppIcon,
  args: { id: "vscode" },
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
      options: iconNames,
    },
  },
}

export const Basic = {}

export const AllIcons = {
  render: (args: { id: IconName }) => (
    <div
      style={{
        display: "grid",
        gap: "12px",
        "grid-template-columns": "repeat(auto-fill, minmax(72px, 1fr))",
      }}
    >
      <For each={iconNames}>
        {(id) => (
          <div
            classList={{ "font-bold": args.id === id }}
            style={{ display: "grid", gap: "6px", "justify-items": "center" }}
          >
            <AppIcon id={id} alt={id} />
            <div style={{ "font-size": "10px", color: "var(--text-weak)", "text-align": "center" }}>{id}</div>
          </div>
        )}
      </For>
    </div>
  ),
}
