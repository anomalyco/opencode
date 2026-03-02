// @ts-nocheck
import * as mod from "./font"

const docs = `### Overview
Loads OpenCode typography assets and mono nerd fonts.

Render once at the app root or Storybook preview.

### API
- No props.

### Variants and states
- Fonts include sans and multiple mono families.

### Behavior
- Injects @font-face rules and preload links into the document head.

### Accessibility
- Not applicable.

### Theming/tokens
- Provides font families used by theme tokens.

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
