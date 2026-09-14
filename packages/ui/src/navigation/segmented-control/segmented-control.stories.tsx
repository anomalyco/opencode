import { createSignal } from "solid-js"
import { SegmentedControlItem, SegmentedControl } from "./segmented-control"

const docs = `### Overview
Single-select segmented control with **custom state** and native \`<button type="button">\` segments.

### Accessibility (toggle group style)
- Root: \`role="group"\` — pass \`aria-label\` or \`aria-labelledby\` (standard div attributes).
- Segments: \`aria-pressed\` reflects selection; \`data-pressed\` is set for styling.
- **Arrow Left / Right** move focus between enabled segments; **Home** / **End** focus first / last enabled segment.

### API
- **SegmentedControl:** \`value?\`, \`defaultValue?\`, \`onChange?(value: string | null)\`, \`allowDeselect?\` (default \`false\`), \`disabled?\`, plus native div attributes (\`class\`, \`aria-*\`, \`ref\`, etc.).
- **SegmentedControlItem:** \`value\` (string), \`disabled?\`, \`children\` (label), plus other button attributes except \`type\`.

### Behavior
- With default \`allowDeselect={false}\`, clicking the active segment does nothing; selection is never cleared.
- With \`allowDeselect\`, clicking the active segment clears selection and \`onChange(null)\` runs.

### Theming
- \`data-slot="segmented-control-v2"\` on the track; items use \`data-slot="segmented-control-v2-item"\` and \`data-pressed\` when selected.
`

export default {
  title: "UI/SegmentedControl",
  id: "ui-segmented-control",
  component: SegmentedControl,
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
    <SegmentedControl defaultValue="a" aria-label="Demo segment control">
      <SegmentedControlItem value="a">Label</SegmentedControlItem>
      <SegmentedControlItem value="b">Label</SegmentedControlItem>
      <SegmentedControlItem value="c">Label</SegmentedControlItem>
      <SegmentedControlItem value="d">Label</SegmentedControlItem>
    </SegmentedControl>
  ),
}

export const Controlled = {
  render: () => {
    const [value, setValue] = createSignal("b")
    return (
      <div style={{ display: "grid", gap: "12px", "justify-items": "start" }}>
        <SegmentedControl value={value()} onChange={setValue} aria-label="View mode">
          <SegmentedControlItem value="a">List</SegmentedControlItem>
          <SegmentedControlItem value="b">Grid</SegmentedControlItem>
          <SegmentedControlItem value="c">Board</SegmentedControlItem>
        </SegmentedControl>
        <div style={{ "font-family": "var(--v2-font-family-sans)", "font-size": "12px", color: "#808080" }}>
          Value: {value()}
        </div>
      </div>
    )
  },
}

export const AllowDeselect = {
  render: () => {
    const [value, setValue] = createSignal<string | null>("a")
    return (
      <div style={{ display: "grid", gap: "12px", "justify-items": "start" }}>
        <SegmentedControl value={value()} allowDeselect onChange={setValue} aria-label="Optional selection">
          <SegmentedControlItem value="a">A</SegmentedControlItem>
          <SegmentedControlItem value="b">B</SegmentedControlItem>
          <SegmentedControlItem value="c">C</SegmentedControlItem>
        </SegmentedControl>
        <div style={{ "font-family": "var(--v2-font-family-sans)", "font-size": "12px", color: "#808080" }}>
          Value: {value() === null ? "none" : value()}
        </div>
      </div>
    )
  },
}

export const WithDisabledItem = {
  render: () => (
    <SegmentedControl defaultValue="a" aria-label="Segments with one disabled">
      <SegmentedControlItem value="a">One</SegmentedControlItem>
      <SegmentedControlItem value="b" disabled>
        Two
      </SegmentedControlItem>
      <SegmentedControlItem value="c">Three</SegmentedControlItem>
    </SegmentedControl>
  ),
}

export const FullWidth = {
  render: () => (
    <div style={{ width: "320px" }}>
      <SegmentedControl defaultValue="x" class="segmented-control-v2--full-width" aria-label="Full width">
        <SegmentedControlItem value="x">A</SegmentedControlItem>
        <SegmentedControlItem value="y">B</SegmentedControlItem>
        <SegmentedControlItem value="z">C</SegmentedControlItem>
      </SegmentedControl>
    </div>
  ),
}
