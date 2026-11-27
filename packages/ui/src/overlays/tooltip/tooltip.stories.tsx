import { createSignal } from "solid-js"
import { Tooltip, TooltipText } from "./tooltip"
import { Button } from "@opencode/ui/button"
import { Keybind } from "@opencode/ui/keybind"
import { Menu } from "@opencode/ui/menu"

const docs = `### Overview
Floating tooltip built on Kobalte's tooltip primitive.

### API
- \`value\`: Content rendered inside the floating tooltip.
- \`children\`: The trigger element that activates the tooltip on hover/focus.
- \`placement\`: Kobalte placement string (e.g. "top", "bottom", "left", "right").
- \`appearance\`: \`compact\` (default), \`standard\`, or \`large\`.
- \`inactive\`: When true, renders only the trigger without tooltip behavior.
- \`forceOpen\`: Forces the tooltip to stay open.
- Inherits Kobalte Tooltip root props.
`

export default {
  title: "UI/Tooltip",
  id: "ui-tooltip",
  component: Tooltip,
  tags: ["autodocs"],
  parameters: {
    frameHeight: "300px",
    frameBackground: "#fff",
    docs: {
      description: {
        component: docs,
      },
    },
  },
}

function SimpleTip(props: { forceOpen?: boolean; inactive?: boolean }) {
  return (
    <div style={{ padding: "80px", display: "flex", "justify-content": "center" }}>
      <Tooltip value="Tooltip Text" {...props}>
        <span>Hover me</span>
      </Tooltip>
    </div>
  )
}

export const Simple = { render: () => <SimpleTip /> }

export const Open = { render: () => <SimpleTip forceOpen /> }

export const Inactive = { render: () => <SimpleTip inactive /> }

export const WithButton = {
  render: () => {
    const [count, setCount] = createSignal(0)

    return (
      <div
        style={{ padding: "80px", display: "flex", gap: "12px", "align-items": "center", "justify-content": "center" }}
      >
        <Tooltip value="Add one to the count">
          <Button onClick={() => setCount((value) => value + 1)}>Add</Button>
        </Tooltip>
        <Tooltip value="Reset the count">
          <Button onClick={() => setCount(0)}>Reset</Button>
        </Tooltip>
        <output>Count: {count()}</output>
      </div>
    )
  },
}

export const Appearances = {
  render: () => (
    <div style={{ padding: "80px", display: "flex", gap: "32px", "justify-content": "center" }}>
      <Tooltip appearance="standard" value="Standard tooltip">
        <span>Standard</span>
      </Tooltip>
      <Tooltip appearance="compact" value="Compact tooltip">
        <span>Compact</span>
      </Tooltip>
      <Tooltip appearance="large" value="Large tooltip">
        <span>Large</span>
      </Tooltip>
    </div>
  ),
}

export const WithKeybind = {
  render: () => (
    <div style={{ padding: "80px", display: "flex", "justify-content": "center" }}>
      <Tooltip
        value={
          <>
            Tooltip Text
            <Keybind keys={["⌘", "⌘"]} variant="neutral" />
          </>
        }
      >
        <span>Hover me</span>
      </Tooltip>
    </div>
  ),
}

export const WithMenu = {
  render: () => (
    <div style={{ padding: "80px", display: "flex", "justify-content": "center" }}>
      <Tooltip value="More actions">
        <Menu gutter={6}>
          <Menu.Trigger as={Button}>Actions</Menu.Trigger>
          <Menu.Portal>
            <Menu.Content>
              <Menu.Item>Rename</Menu.Item>
              <Menu.Item>Delete</Menu.Item>
            </Menu.Content>
          </Menu.Portal>
        </Menu>
      </Tooltip>
    </div>
  ),
}

export const Path = {
  render: () => (
    <div style={{ padding: "80px", display: "flex", "justify-content": "center" }}>
      <Tooltip
        value={
          <>
            <TooltipText>Components</TooltipText>
            <TooltipText variant="faint">/</TooltipText>
            <TooltipText>Tooltip</TooltipText>
          </>
        }
      >
        <span>Hover me</span>
      </Tooltip>
    </div>
  ),
}

export const TitleDescription = {
  render: () => (
    <div style={{ padding: "80px", display: "flex", "justify-content": "center" }}>
      <Tooltip
        value={
          <>
            <TooltipText>Title</TooltipText>
            <TooltipText variant="muted">·</TooltipText>
            <TooltipText variant="muted">Description</TooltipText>
          </>
        }
      >
        <span>Hover me</span>
      </Tooltip>
    </div>
  ),
}

export const Colors = {
  render: () => (
    <div style={{ padding: "80px", display: "flex", "flex-direction": "column", gap: "48px", "align-items": "center" }}>
      <Tooltip
        forceOpen
        value={
          <>
            <TooltipText>Included in Go</TooltipText>
            <TooltipText variant="accent">60% off</TooltipText>
          </>
        }
      >
        <span>Accent</span>
      </Tooltip>
      <Tooltip
        forceOpen
        value={
          <>
            <TooltipText>Everyone except</TooltipText>
            <TooltipText variant="warning">Set by the rules below</TooltipText>
          </>
        }
      >
        <span>Warning</span>
      </Tooltip>
    </div>
  ),
}

export const Wrapping = {
  render: () => (
    <div style={{ padding: "80px", display: "flex", "justify-content": "center" }}>
      <Tooltip
        forceOpen
        contentStyle={{ "max-width": "200px" }}
        value="Only with OpenCode Go. Stops when the allowance runs out."
      >
        <span>Two lines</span>
      </Tooltip>
    </div>
  ),
}
