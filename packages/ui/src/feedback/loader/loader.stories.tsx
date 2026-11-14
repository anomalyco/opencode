import { Loader } from "./loader"

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
  title: "UI/Loader",
  id: "ui-loader",
  component: Loader,
  args: { size: 16 },
  argTypes: { size: { control: { type: "range", min: 8, max: 32, step: 1 } } },
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
  render: (props: { size: number }) => <Loader width={props.size} height={props.size} />,
}

export const Sizes = {
  render: (props: { size: number }) => (
    <div style={{ display: "flex", gap: "16px", "align-items": "center" }}>
      <Loader width={12} height={12} />
      <Loader width={props.size} height={props.size} />
      <Loader width={24} height={24} />
    </div>
  ),
}
