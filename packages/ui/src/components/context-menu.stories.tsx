// @ts-nocheck
import * as mod from "./context-menu"

const docs = `### Overview
Context menu for right-click interactions with composable items and submenus.

Use \`ItemLabel\` and \`ItemDescription\` for rich items.

### API
- Root accepts Kobalte ContextMenu props (\`open\`, \`defaultOpen\`, \`onOpenChange\`).
- Compose \`Trigger\`, \`Content\`, \`Item\`, \`Separator\`, and optional \`Sub\` sections.

### Variants and states
- Supports grouped sections and nested submenus.

### Behavior
- Opens on context menu gesture over the trigger element.

### Accessibility
- TODO: confirm keyboard and focus behavior from Kobalte.

### Theming/tokens
- Uses \`data-component="context-menu"\` and slot attributes for styling.

`

export default {
  title: "UI/ContextMenu",
  id: "components-context-menu",
  component: mod.ContextMenu,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
}

export const Basic = {
  render: () => (
    <mod.ContextMenu defaultOpen>
      <mod.ContextMenu.Trigger>
        <div
          style={{
            padding: "20px",
            border: "1px dashed var(--border-weak)",
            "border-radius": "8px",
            color: "var(--text-weak)",
          }}
        >
          Right click (or open) here
        </div>
      </mod.ContextMenu.Trigger>
      <mod.ContextMenu.Portal>
        <mod.ContextMenu.Content>
          <mod.ContextMenu.Group>
            <mod.ContextMenu.GroupLabel>Actions</mod.ContextMenu.GroupLabel>
            <mod.ContextMenu.Item>
              <mod.ContextMenu.ItemLabel>Copy</mod.ContextMenu.ItemLabel>
            </mod.ContextMenu.Item>
            <mod.ContextMenu.Item>
              <mod.ContextMenu.ItemLabel>Paste</mod.ContextMenu.ItemLabel>
            </mod.ContextMenu.Item>
          </mod.ContextMenu.Group>
          <mod.ContextMenu.Separator />
          <mod.ContextMenu.Sub>
            <mod.ContextMenu.SubTrigger>More</mod.ContextMenu.SubTrigger>
            <mod.ContextMenu.SubContent>
              <mod.ContextMenu.Item>
                <mod.ContextMenu.ItemLabel>Duplicate</mod.ContextMenu.ItemLabel>
              </mod.ContextMenu.Item>
              <mod.ContextMenu.Item>
                <mod.ContextMenu.ItemLabel>Move</mod.ContextMenu.ItemLabel>
              </mod.ContextMenu.Item>
            </mod.ContextMenu.SubContent>
          </mod.ContextMenu.Sub>
        </mod.ContextMenu.Content>
      </mod.ContextMenu.Portal>
    </mod.ContextMenu>
  ),
}

export const CheckboxRadio = {
  render: () => (
    <mod.ContextMenu defaultOpen>
      <mod.ContextMenu.Trigger>
        <div
          style={{
            padding: "20px",
            border: "1px dashed var(--border-weak)",
            "border-radius": "8px",
            color: "var(--text-weak)",
          }}
        >
          Right click (or open) here
        </div>
      </mod.ContextMenu.Trigger>
      <mod.ContextMenu.Portal>
        <mod.ContextMenu.Content>
          <mod.ContextMenu.CheckboxItem checked>Show line numbers</mod.ContextMenu.CheckboxItem>
          <mod.ContextMenu.CheckboxItem>Wrap lines</mod.ContextMenu.CheckboxItem>
          <mod.ContextMenu.Separator />
          <mod.ContextMenu.RadioGroup value="compact">
            <mod.ContextMenu.RadioItem value="compact">Compact</mod.ContextMenu.RadioItem>
            <mod.ContextMenu.RadioItem value="comfortable">Comfortable</mod.ContextMenu.RadioItem>
          </mod.ContextMenu.RadioGroup>
        </mod.ContextMenu.Content>
      </mod.ContextMenu.Portal>
    </mod.ContextMenu>
  ),
}
