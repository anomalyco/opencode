// @ts-nocheck
import * as mod from "./spinner"
import { create } from "../storybook/scaffold"

const docs = `### Overview
Animated loading indicator for inline or page-level loading states.

Use with \`Button\` or in empty states.

### API
- Accepts standard SVG props (class, style).

### Variants and states
- Single default animation style.

### Behavior
- Animation is CSS-driven via data attributes.

### Accessibility
- Use alongside text or aria-live regions to convey loading state.

### Theming/tokens
- Uses \`data-component="spinner"\` for styling hooks.

`

const story = create({ title: "UI/Spinner", mod })

export default {
  title: "UI/Spinner",
  id: "components-spinner",
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

export const Sizes = {
  render: () => (
    <div style={{ display: "flex", gap: "16px", "align-items": "center" }}>
      <mod.Spinner style={{ width: "12px", height: "12px" }} />
      <mod.Spinner style={{ width: "20px", height: "20px" }} />
      <mod.Spinner style={{ width: "28px", height: "28px" }} />
    </div>
  ),
}
