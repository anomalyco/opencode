import { createSignal, onMount, type ParentProps } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { ContextMenu } from "./context-menu"

const docs = `### Overview
Context menu for right-click interactions with composable items and submenus.

Use \`ItemLabel\` and \`ItemDescription\` for rich items.

### API
- The trigger opens the menu at the pointer; the root reports changes through \`onOpenChange\`.
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
  component: ContextMenu,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
}

function MenuArea(props: ParentProps<{ initiallyOpen?: boolean }>) {
  let trigger!: HTMLDivElement

  // Kobalte takes the anchor from a contextmenu event; its context menu has no defaultOpen prop.
  onMount(() => {
    if (!props.initiallyOpen) return
    const box = trigger.getBoundingClientRect()
    trigger.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: box.left + box.width / 2,
        clientY: box.top + box.height / 2,
      }),
    )
  })

  return (
    <ContextMenu modal={!props.initiallyOpen}>
      <ContextMenu.Trigger ref={trigger}>
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
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content>{props.children}</ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu>
  )
}

export const Basic = {
  render: () => (
    <MenuArea>
      <ContextMenu.Group>
        <ContextMenu.GroupLabel>Actions</ContextMenu.GroupLabel>
        <ContextMenu.Item>
          <ContextMenu.ItemLabel>Copy</ContextMenu.ItemLabel>
        </ContextMenu.Item>
        <ContextMenu.Item>
          <ContextMenu.ItemLabel>Paste</ContextMenu.ItemLabel>
        </ContextMenu.Item>
      </ContextMenu.Group>
      <ContextMenu.Separator />
      <ContextMenu.Sub>
        <ContextMenu.SubTrigger>More</ContextMenu.SubTrigger>
        <ContextMenu.SubContent>
          <ContextMenu.Item>
            <ContextMenu.ItemLabel>Duplicate</ContextMenu.ItemLabel>
          </ContextMenu.Item>
          <ContextMenu.Item>
            <ContextMenu.ItemLabel>Move</ContextMenu.ItemLabel>
          </ContextMenu.Item>
        </ContextMenu.SubContent>
      </ContextMenu.Sub>
    </MenuArea>
  ),
}

function CheckedIndicator() {
  return (
    <ContextMenu.ItemIndicator>
      <Icon name="check-small" />
    </ContextMenu.ItemIndicator>
  )
}

function OptionsMenu(props: { initiallyOpen?: boolean }) {
  const [numbers, setNumbers] = createSignal(true)

  const [wrap, setWrap] = createSignal(false)

  const [density, setDensity] = createSignal("compact")

  return (
    <MenuArea initiallyOpen={props.initiallyOpen}>
      <ContextMenu.CheckboxItem checked={numbers()} onChange={setNumbers}>
        Show line numbers
        <CheckedIndicator />
      </ContextMenu.CheckboxItem>
      <ContextMenu.CheckboxItem checked={wrap()} onChange={setWrap} disabled={props.initiallyOpen}>
        Wrap lines
        <CheckedIndicator />
      </ContextMenu.CheckboxItem>
      <ContextMenu.Separator />
      <ContextMenu.RadioGroup value={density()} onChange={setDensity}>
        <ContextMenu.RadioItem value="compact">
          Compact
          <CheckedIndicator />
        </ContextMenu.RadioItem>
        <ContextMenu.RadioItem value="comfortable">
          Comfortable
          <CheckedIndicator />
        </ContextMenu.RadioItem>
      </ContextMenu.RadioGroup>
    </MenuArea>
  )
}

export const CheckboxRadio = { render: () => <OptionsMenu /> }

export const OpenWithDisabledItem = { render: () => <OptionsMenu initiallyOpen /> }
