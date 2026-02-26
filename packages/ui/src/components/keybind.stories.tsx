// @ts-nocheck
import * as mod from "./keybind"
import { create } from "../storybook/scaffold"

const docs = `### Overview
Keyboard shortcut pill for displaying keybindings.

Pair with menu items or command palettes.

### API
- Children render the key sequence text.
- Accepts standard span props.

### Variants and states
- Single visual style.

### Behavior
- Presentational only.

### Accessibility
- Ensure text conveys the shortcut (e.g., "Cmd+K").

### Theming/tokens
- Uses \`data-component="keybind"\`.

`

const story = create({ title: "UI/Keybind", mod, args: { children: "Cmd+K" } })
export default {
  title: "UI/Keybind",
  id: "components-keybind",
  component: story.meta.component,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
}

export const Basic = story.Basic
