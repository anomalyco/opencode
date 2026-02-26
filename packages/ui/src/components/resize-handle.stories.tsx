// @ts-nocheck
import { createSignal } from "solid-js"
import * as mod from "./resize-handle"

const docs = `### Overview
Drag handle for resizing panels or split views.

Use alongside resizable panels and split layouts.

### API
- Required: \`direction\`, \`size\`, \`min\`, \`max\`, \`onResize\`.
- Optional: \`edge\`, \`onCollapse\`, \`collapseThreshold\`.

### Variants and states
- Horizontal and vertical directions.

### Behavior
- Drag updates size and calls \`onResize\` with clamped values.

### Accessibility
- TODO: provide keyboard resizing guidance if needed.

### Theming/tokens
- Uses \`data-component="resize-handle"\` with direction/edge data attributes.

`

export default {
  title: "UI/ResizeHandle",
  id: "components-resize-handle",
  component: mod.ResizeHandle,
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
  render: () => {
    const [size, setSize] = createSignal(240)
    return (
      <div style={{ display: "grid", gap: "8px" }}>
        <div style={{ color: "var(--text-weak)", "font-size": "12px" }}>Size: {size()}px</div>
        <div
          style={{
            width: `${size()}px`,
            height: "48px",
            "background-color": "var(--background-stronger)",
            "border-radius": "6px",
          }}
        />
        <mod.ResizeHandle
          direction="horizontal"
          size={size()}
          min={120}
          max={480}
          onResize={setSize}
          style="height:24px;border:1px dashed color-mix(in oklab, var(--text-base) 20%, transparent)"
        />
      </div>
    )
  },
}

export const Vertical = {
  render: () => {
    const [size, setSize] = createSignal(180)
    return (
      <div style={{ display: "grid", gap: "8px", width: "220px" }}>
        <div style={{ color: "var(--text-weak)", "font-size": "12px" }}>Size: {size()}px</div>
        <div
          style={{
            height: `${size()}px`,
            "background-color": "var(--background-stronger)",
            "border-radius": "6px",
          }}
        />
        <mod.ResizeHandle
          direction="vertical"
          size={size()}
          min={120}
          max={320}
          onResize={setSize}
          style="width:24px;border:1px dashed color-mix(in oklab, var(--text-base) 20%, transparent)"
        />
      </div>
    )
  },
}

export const Collapse = {
  render: () => {
    const [size, setSize] = createSignal(200)
    const [collapsed, setCollapsed] = createSignal(false)
    return (
      <div style={{ display: "grid", gap: "8px" }}>
        <div style={{ color: "var(--text-weak)", "font-size": "12px" }}>
          {collapsed() ? "Collapsed" : `Size: ${size()}px`}
        </div>
        <div
          style={{
            width: `${collapsed() ? 0 : size()}px`,
            height: "48px",
            "background-color": "var(--background-stronger)",
            "border-radius": "6px",
          }}
        />
        <mod.ResizeHandle
          direction="horizontal"
          size={size()}
          min={80}
          max={360}
          collapseThreshold={100}
          onResize={(next) => {
            setCollapsed(false)
            setSize(next)
          }}
          onCollapse={() => setCollapsed(true)}
          style="height:24px;border:1px dashed color-mix(in oklab, var(--text-base) 20%, transparent)"
        />
      </div>
    )
  },
}

export const EdgeStart = {
  render: () => {
    const [size, setSize] = createSignal(240)
    return (
      <div style={{ display: "grid", gap: "8px" }}>
        <div style={{ color: "var(--text-weak)", "font-size": "12px" }}>Size: {size()}px</div>
        <div
          style={{
            width: `${size()}px`,
            height: "48px",
            "background-color": "var(--background-stronger)",
            "border-radius": "6px",
          }}
        />
        <mod.ResizeHandle
          direction="horizontal"
          edge="start"
          size={size()}
          min={120}
          max={480}
          onResize={setSize}
          style="height:24px;border:1px dashed color-mix(in oklab, var(--text-base) 20%, transparent)"
        />
      </div>
    )
  },
}
