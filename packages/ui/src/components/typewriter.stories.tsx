// @ts-nocheck
import * as mod from "./typewriter"
import { create } from "../storybook/scaffold"

const docs = `### Overview
Animated typewriter text effect for short inline messages.

Use for short status lines; avoid long paragraphs.

### API
- Optional: \`text\` string; if absent, nothing is rendered.
- Optional: \`as\` to change the rendered element.

### Variants and states
- Single animation style with cursor blink.

### Behavior
- Types one character at a time with randomized delays.

### Accessibility
- TODO: confirm if cursor should be aria-hidden in all contexts.

### Theming/tokens
- Uses \`blinking-cursor\` class for cursor styling.

`

const story = create({ title: "UI/Typewriter", mod, args: { text: "Typewriter text" } })

export default {
  title: "UI/Typewriter",
  id: "components-typewriter",
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

export const Inline = {
  args: {
    text: "Inline typewriter",
    as: "span",
  },
}
