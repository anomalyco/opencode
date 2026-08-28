import { LoaderV2 } from "./loader-v2"

const docs = `### Overview
Circular v2 loader for compact loading states.

### API
- Accepts standard SVG props.

### Behavior
- The foreground ring covers 33% of the circumference and rotates continuously.

### Accessibility
- Sets \`aria-hidden="true"\` by default.
`

export default {
  title: "UI V2/Loader",
  id: "components-loader-v2",
  component: LoaderV2,
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
  render: () => <LoaderV2 />,
}

export const Sizes = {
  render: () => (
    <div style={{ display: "flex", gap: "16px", "align-items": "center" }}>
      <LoaderV2 width={12} height={12} />
      <LoaderV2 />
      <LoaderV2 width={24} height={24} />
    </div>
  ),
}
