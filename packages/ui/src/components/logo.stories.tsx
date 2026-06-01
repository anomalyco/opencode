// @ts-nocheck
import * as mod from "./logo"

const docs = `### Overview
OpenCode logo assets: mark, splash, and wordmark.

Use Mark for compact spaces, Logo for headers, Splash for hero sections.

### API
- \`Mark\`, \`Splash\`, and \`Logo\` components accept standard SVG props.

### Variants and states
- Multiple logo variants for different contexts.

### Behavior
- Pure SVG rendering.

### Accessibility
- Provide title/aria-label when logos convey meaning.

### Theming/tokens
- Uses theme color tokens via CSS variables.

`

export default {
  title: "UI/Logo",
  id: "components-logo",
  component: mod.Logo,
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
    <div style={{ display: "grid", gap: "16px", "align-items": "start" }}>
      <div>
        <div style={{ color: "var(--text-weak)", "font-size": "12px" }}>Mark</div>
        <mod.Mark />
      </div>
      <div>
        <div style={{ color: "var(--text-weak)", "font-size": "12px" }}>Splash</div>
        <mod.Splash style={{ width: "80px", height: "100px" }} />
      </div>
      <div>
        <div style={{ color: "var(--text-weak)", "font-size": "12px" }}>Logo</div>
        <mod.Logo style={{ width: "200px" }} />
      </div>
    </div>
  ),
}
