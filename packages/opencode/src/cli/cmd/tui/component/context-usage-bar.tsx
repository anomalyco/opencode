import { type Component, createMemo, Show } from "solid-js"
import type { RGBA } from "@opentui/core"

export interface ContextUsageBarProps {
  currentTokens: number
  tokenLimit: number
  agentColor: RGBA
  backgroundColor?: RGBA
  width?: number // Width of the sidebar
  assistantColor?: RGBA
  toolColor?: RGBA
  userColor?: RGBA
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

  const barSegments = createMemo(() => {
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

    const segments: Array<{ char: string; color: RGBA }> = []

    // Add left border
    segments.push({ char: "▐", color: props.agentColor })

    // Filled portion with rotating pattern and colors
    for (let i = 0; i < filledCount; i++) {
      switch (i % 4) {
        case 0:
          segments.push({
            char: charAssistant,
            color: props.assistantColor || props.agentColor,
          })
          break
        case 1:
          segments.push({
            char: charTool,
            color: props.toolColor || props.agentColor,
          })
          break
        case 2:
          segments.push({
            char: charUser,
            color: props.userColor || props.agentColor,
          })
          break
        default:
          segments.push({
            char: charAssistant,
            color: props.assistantColor || props.agentColor,
          })
      }
    }

    // Empty portion
    for (let i = filledCount; i < barLength; i++) {
      segments.push({ char: charEmpty, color: props.agentColor })
    }

    // Add right border
    segments.push({ char: "▌", color: props.agentColor })

    return segments
  })

  const percentText = createMemo(() => {
    return ` ${Math.round(usagePercent())}%`
  })

  return (
    <Show when={props.tokenLimit > 0}>
      <box flexDirection="column">
        <box flexDirection="row" paddingLeft={0} paddingRight={1}>
          {barSegments().map((segment) => (
            <text fg={segment.color} bg={props.backgroundColor}>
              {segment.char}
            </text>
          ))}
          <text fg={props.agentColor} bg={props.backgroundColor}>
            {percentText()}
          </text>
        </box>
        <box flexDirection="row" gap={1} paddingTop={1} paddingBottom={1}>
          <text fg={props.assistantColor || props.agentColor}>▓ AI</text>
          <text fg={props.toolColor || props.agentColor}>█ Tool</text>
          <text fg={props.userColor || props.agentColor}>▒ User</text>
        </box>
      </box>
    </Show>
  )
}
