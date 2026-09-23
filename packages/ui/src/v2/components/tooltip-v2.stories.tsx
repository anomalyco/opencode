import { TooltipV2, TooltipV2Group } from "./tooltip-v2"
import { KeybindV2 } from "./keybind-v2"

const docs = `### Overview
Floating tooltip built on Kobalte's tooltip primitive with v2 styling.

### API
- \`value\`: Content rendered inside the floating tooltip.
- \`children\`: The trigger element that activates the tooltip on hover/focus.
- \`placement\`: Kobalte placement string (e.g. "top", "bottom", "left", "right").
- \`inactive\`: When true, renders only the trigger without tooltip behavior.
- \`forceOpen\`: Forces the tooltip to stay open.
- \`TooltipV2Group\`: Wrap neighboring tooltips to skip their enter/exit animations and hover delays when moving between triggers. The first hover still uses each tooltip's configured delay; the group cools down after 300ms.
- Inherits Kobalte Tooltip root props.
`

export default {
  title: "UI V2/Tooltip",
  id: "components-tooltip-v2",
  component: TooltipV2,
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

export const Simple = {
  render: () => (
    <div style={{ padding: "80px", display: "flex", "justify-content": "center" }}>
      <TooltipV2 value="Tooltip Text">
        <span>Hover me</span>
      </TooltipV2>
    </div>
  ),
}

export const Grouped = {
  render: () => (
    <div style={{ padding: "80px" }}>
      <p>Hover the first button, then move across the group. Leave for a moment to reset the initial delay.</p>
      <TooltipV2Group>
        <div style={{ display: "flex", gap: "8px" }}>
          <TooltipV2 value="First tooltip" openDelay={800}>
            <button type="button">First</button>
          </TooltipV2>
          <TooltipV2 value="Second tooltip" openDelay={800}>
            <button type="button">Second</button>
          </TooltipV2>
          <TooltipV2 value="Third tooltip" openDelay={800}>
            <button type="button">Third</button>
          </TooltipV2>
        </div>
      </TooltipV2Group>
    </div>
  ),
}

export const WithKeybind = {
  render: () => (
    <div style={{ padding: "80px", display: "flex", "justify-content": "center" }}>
      <TooltipV2
        value={
          <>
            Tooltip Text
            <KeybindV2 keys={["⌘", "⌘"]} variant="neutral" />
          </>
        }
      >
        <span>Hover me</span>
      </TooltipV2>
    </div>
  ),
}

export const Path = {
  render: () => (
    <div style={{ padding: "80px", display: "flex", "justify-content": "center" }}>
      <TooltipV2
        value={
          <>
            Components <span style={{ color: "var(--text-text-faint)" }}>/</span> Tooltip
          </>
        }
      >
        <span>Hover me</span>
      </TooltipV2>
    </div>
  ),
}

export const TitleDescription = {
  render: () => (
    <div style={{ padding: "80px", display: "flex", "justify-content": "center" }}>
      <TooltipV2
        value={
          <>
            <span>Title</span>
            <span style={{ color: "var(--text-text-faint)" }}>·</span>
            <span style={{ color: "var(--text-text-faint)" }}>Description</span>
          </>
        }
      >
        <span>Hover me</span>
      </TooltipV2>
    </div>
  ),
}
