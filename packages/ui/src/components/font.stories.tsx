// @ts-nocheck
import * as mod from "./font"

const docs = `### Overview
Uses native system font stacks for sans and mono typography.

Optional compatibility component. Existing roots can keep rendering it, but it does nothing.

### API
- No props.

### Variants and states
- No variants.

### Behavior
- Compatibility wrapper only. No font assets are injected or preloaded.

### Accessibility
- Not applicable.

### Theming/tokens
- Theme tokens come from CSS variables, not this component.

`

export default {
  title: "UI/Font",
  id: "components-font",
  component: mod.Font,
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
    <div style={{ display: "grid", gap: "8px" }}>
      <mod.Font />
      <div style={{ "font-family": "var(--font-family-sans)" }}>OpenCode Sans Sample</div>
      <div style={{ "font-family": "var(--font-family-mono)" }}>OpenCode Mono Sample</div>
    </div>
  ),
}
