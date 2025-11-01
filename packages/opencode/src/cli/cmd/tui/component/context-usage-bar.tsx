import { type Component, createMemo, Show } from "solid-js"
import type { RGBA } from "@opentui/core"

export interface ContextUsageBarProps {
  currentTokens: number
  tokenLimit: number
  agentColor: RGBA
  backgroundColor?: RGBA
  width?: number // Width of the sidebar
}

/**
 * Visual context usage indicator for TUI showing token usage as a segmented bar
 * Ported from Go TUI status component
 */
export const ContextUsageBar: Component<ContextUsageBarProps> = (props) => {
  const usagePercent = createMemo(() => {
    if (props.tokenLimit === 0) return 0
    return (props.currentTokens / props.tokenLimit) * 100
  })

  const barContent = createMemo(() => {
    // Calculate bar length based on width
    // Format: [bar] [percentage]
    // Percentage = ~4, spaces = 1, padding = 4, borders = 2
    // Available for bar = width - 11
    const availableWidth = (props.width || 40) - 11
    const barLength = Math.max(15, availableWidth) // At least 15 chars

    const percent = usagePercent()
    const filledCount = Math.min(Math.floor((barLength * percent) / 100), barLength)

    // Visual characters for the bar
    const charEmpty = "░"
    const charAssistant = "▓"
    const charTool = "█"
    const charUser = "▒"

    let bar = "▐"

    // Filled portion with rotating pattern
    for (let i = 0; i < filledCount; i++) {
      switch (i % 4) {
        case 0:
          bar += charAssistant
          break
        case 1:
          bar += charTool
          break
        case 2:
          bar += charUser
          break
        default:
          bar += charAssistant
      }
    }

    // Empty portion
    for (let i = filledCount; i < barLength; i++) {
      bar += charEmpty
    }

    bar += "▌"
    return bar
  })

  const percentText = createMemo(() => {
    return ` ${Math.round(usagePercent())}%`
  })

  return (
    <Show when={props.tokenLimit > 0}>
      <box flexDirection="row" paddingLeft={0} paddingRight={1}>
        <text fg={props.agentColor} bg={props.backgroundColor}>
          {barContent()}
          {percentText()}
        </text>
      </box>
    </Show>
  )
}
