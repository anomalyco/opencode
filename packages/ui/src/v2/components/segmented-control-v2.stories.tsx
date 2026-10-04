import { createSignal } from "solid-js"
import { SegmentedControlItemV2, SegmentedControlV2 } from "./segmented-control-v2"

const docs = `### Overview
Single-select segmented control with **custom state** and native \`<button type="button">\` segments.

### Accessibility (toggle group style)
- Root: \`role="group"\` — pass \`aria-label\` or \`aria-labelledby\` (standard div attributes).
- Segments: \`aria-pressed\` reflects selection; \`data-pressed\` is set for styling.
- **Arrow Left / Right** move focus between enabled segments; **Home** / **End** focus first / last enabled segment.

### API
- **SegmentedControlV2:** \`value?\`, \`defaultValue?\`, \`onChange?(value: string | null)\`, \`allowDeselect?\` (default \`false\`), \`disabled?\`, plus native div attributes (\`class\`, \`aria-*\`, \`ref\`, etc.).
- **SegmentedControlItemV2:** \`value\` (string), \`disabled?\`, \`children\` (label), plus other button attributes except \`type\`.

### Behavior
- With default \`allowDeselect={false}\`, clicking the active segment does nothing; selection is never cleared.
- With \`allowDeselect\`, clicking the active segment clears selection and \`onChange(null)\` runs.

### Theming
- \`data-slot="segmented-control-v2"\` on the track; items use \`data-slot="segmented-control-v2-item"\` and \`data-pressed\` when selected.
`

export default {
  title: "UI V2/SegmentedControl",
  id: "components-segmented-control-v2",
  component: SegmentedControlV2,
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
    <SegmentedControlV2 defaultValue="a" aria-label="Demo segment control">
      <SegmentedControlItemV2 value="a">Label</SegmentedControlItemV2>
      <SegmentedControlItemV2 value="b">Label</SegmentedControlItemV2>
      <SegmentedControlItemV2 value="c">Label</SegmentedControlItemV2>
      <SegmentedControlItemV2 value="d">Label</SegmentedControlItemV2>
    </SegmentedControlV2>
  ),
}

export const Controlled = {
  render: () => {
    const [value, setValue] = createSignal("b")
    return (
      <div style={{ display: "grid", gap: "12px", "justify-items": "start" }}>
        <SegmentedControlV2 value={value()} onChange={setValue} aria-label="View mode">
          <SegmentedControlItemV2 value="a">List</SegmentedControlItemV2>
          <SegmentedControlItemV2 value="b">Grid</SegmentedControlItemV2>
          <SegmentedControlItemV2 value="c">Board</SegmentedControlItemV2>
        </SegmentedControlV2>
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
        <SegmentedControlV2 value={value()} allowDeselect onChange={setValue} aria-label="Optional selection">
          <SegmentedControlItemV2 value="a">A</SegmentedControlItemV2>
          <SegmentedControlItemV2 value="b">B</SegmentedControlItemV2>
          <SegmentedControlItemV2 value="c">C</SegmentedControlItemV2>
        </SegmentedControlV2>
        <div style={{ "font-family": "var(--v2-font-family-sans)", "font-size": "12px", color: "#808080" }}>
          Value: {value() === null ? "none" : value()}
        </div>
      </div>
    )
  },
}

export const WithDisabledItem = {
  render: () => (
    <SegmentedControlV2 defaultValue="a" aria-label="Segments with one disabled">
      <SegmentedControlItemV2 value="a">One</SegmentedControlItemV2>
      <SegmentedControlItemV2 value="b" disabled>
        Two
      </SegmentedControlItemV2>
      <SegmentedControlItemV2 value="c">Three</SegmentedControlItemV2>
    </SegmentedControlV2>
  ),
}

export const FullWidth = {
  render: () => (
    <div style={{ width: "320px" }}>
      <SegmentedControlV2 defaultValue="x" class="segmented-control-v2--full-width" aria-label="Full width">
        <SegmentedControlItemV2 value="x">A</SegmentedControlItemV2>
        <SegmentedControlItemV2 value="y">B</SegmentedControlItemV2>
        <SegmentedControlItemV2 value="z">C</SegmentedControlItemV2>
      </SegmentedControlV2>
    </div>
  ),
}
