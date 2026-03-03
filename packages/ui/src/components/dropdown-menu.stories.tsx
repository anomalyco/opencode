// @ts-nocheck
import * as mod from "./dropdown-menu"
import { Button } from "./button"

const docs = `### Overview
Dropdown menu built on Kobalte with composable items, groups, and submenus.

Use \`DropdownMenu.ItemLabel\`/\`ItemDescription\` for richer rows.

### API
- Root accepts Kobalte DropdownMenu props (\`open\`, \`defaultOpen\`, \`onOpenChange\`).
- Compose with \`Trigger\`, \`Content\`, \`Item\`, \`Separator\`, and optional \`Sub\` sections.

### Variants and states
- Supports item groups, separators, and nested submenus.

### Behavior
- Menu opens from trigger and renders in a portal by default.

### Accessibility
- TODO: confirm keyboard navigation from Kobalte.

### Theming/tokens
- Uses \`data-component="dropdown-menu"\` and slot attributes for styling.

`

export default {
  title: "UI/DropdownMenu",
  id: "components-dropdown-menu",
  component: mod.DropdownMenu,
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
    <mod.DropdownMenu defaultOpen>
      <mod.DropdownMenu.Trigger as={Button} variant="secondary" size="small">
        Open menu
      </mod.DropdownMenu.Trigger>
      <mod.DropdownMenu.Portal>
        <mod.DropdownMenu.Content>
          <mod.DropdownMenu.Group>
            <mod.DropdownMenu.GroupLabel>Actions</mod.DropdownMenu.GroupLabel>
            <mod.DropdownMenu.Item>
              <mod.DropdownMenu.ItemLabel>New file</mod.DropdownMenu.ItemLabel>
            </mod.DropdownMenu.Item>
            <mod.DropdownMenu.Item>
              <mod.DropdownMenu.ItemLabel>Rename</mod.DropdownMenu.ItemLabel>
              <mod.DropdownMenu.ItemDescription>Shift+R</mod.DropdownMenu.ItemDescription>
            </mod.DropdownMenu.Item>
          </mod.DropdownMenu.Group>
          <mod.DropdownMenu.Separator />
          <mod.DropdownMenu.Sub>
            <mod.DropdownMenu.SubTrigger>More options</mod.DropdownMenu.SubTrigger>
            <mod.DropdownMenu.SubContent>
              <mod.DropdownMenu.Item>
                <mod.DropdownMenu.ItemLabel>Duplicate</mod.DropdownMenu.ItemLabel>
              </mod.DropdownMenu.Item>
              <mod.DropdownMenu.Item>
                <mod.DropdownMenu.ItemLabel>Move</mod.DropdownMenu.ItemLabel>
              </mod.DropdownMenu.Item>
            </mod.DropdownMenu.SubContent>
          </mod.DropdownMenu.Sub>
        </mod.DropdownMenu.Content>
      </mod.DropdownMenu.Portal>
    </mod.DropdownMenu>
  ),
}

export const CheckboxRadio = {
  render: () => (
    <mod.DropdownMenu defaultOpen>
      <mod.DropdownMenu.Trigger as={Button} variant="secondary" size="small">
        Open menu
      </mod.DropdownMenu.Trigger>
      <mod.DropdownMenu.Portal>
        <mod.DropdownMenu.Content>
          <mod.DropdownMenu.CheckboxItem checked>Show line numbers</mod.DropdownMenu.CheckboxItem>
          <mod.DropdownMenu.CheckboxItem>Wrap lines</mod.DropdownMenu.CheckboxItem>
          <mod.DropdownMenu.Separator />
          <mod.DropdownMenu.RadioGroup value="compact">
            <mod.DropdownMenu.RadioItem value="compact">Compact</mod.DropdownMenu.RadioItem>
            <mod.DropdownMenu.RadioItem value="comfortable">Comfortable</mod.DropdownMenu.RadioItem>
          </mod.DropdownMenu.RadioGroup>
        </mod.DropdownMenu.Content>
      </mod.DropdownMenu.Portal>
    </mod.DropdownMenu>
  ),
}
