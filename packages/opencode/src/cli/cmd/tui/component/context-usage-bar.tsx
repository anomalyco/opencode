import { type Component, createMemo, Show } from "solid-js"
import type { RGBA } from "@opentui/core"

export interface ContextUsageBarProps {
  currentTokens: number
  tokenLimit: number
  systemTokens: number
  assistantTokens: number
  userTokens: number
  toolTokens: number
  agentColor: RGBA
  backgroundColor?: RGBA
  width?: number // Width of the sidebar
  systemColor?: RGBA
  assistantColor?: RGBA
  toolColor?: RGBA
  userColor?: RGBA
}

/**
 * Visual context usage indicator for TUI showing token usage as a segmented bar
 * Shows actual breakdown: System (white) -> Assistant (primary) -> User (secondary) -> Tool (accent)
 */
export const ContextUsageBar: Component<ContextUsageBarProps> = (props) => {
  const usagePercent = createMemo(() => {
    if (props.tokenLimit <= 0 || props.currentTokens < 0) return 0
    const percent = (props.currentTokens / props.tokenLimit) * 100
    return Math.min(100, Math.max(0, percent)) // Clamp to 0-100
  })

  const barLength = createMemo(() => Math.max(15, (props.width || 40) - 11))

  const filledCount = createMemo(() => {
    const percent = usagePercent()
    const length = barLength()
    return Math.min(Math.floor((length * percent) / 100), length)
  })

  // Calculate proportional blocks based on actual token usage
  const barSegments = createMemo<Array<{ char: string; color: RGBA; type: string }>>(() => {
    const filled = filledCount()
    const length = barLength()
    const empty = length - filled

    const segments: Array<{ char: string; color: RGBA; type: string }> = []

    // Add left border
    segments.push({ char: "▐", color: props.agentColor, type: "border" })

    if (filled > 0 && props.currentTokens > 0) {
      // Calculate proportional segment counts
      const systemCount = Math.max(1, Math.round((props.systemTokens / props.currentTokens) * filled))
      const assistantCount = Math.max(1, Math.round((props.assistantTokens / props.currentTokens) * filled))
      const userCount = Math.max(1, Math.round((props.userTokens / props.currentTokens) * filled))
      const toolCount = Math.max(1, Math.round((props.toolTokens / props.currentTokens) * filled))

      // Adjust to fit exactly
      let total = systemCount + assistantCount + userCount + toolCount
      let diff = filled - total

      // Distribute difference (usually ±1-2 segments due to rounding)
      if (diff > 0) {
        // Add to largest category
        if (props.systemTokens >= Math.max(props.assistantTokens, props.userTokens, props.toolTokens)) {
          total = systemCount + diff + assistantCount + userCount + toolCount
        } else if (props.assistantTokens >= Math.max(props.userTokens, props.toolTokens)) {
          total = systemCount + assistantCount + diff + userCount + toolCount
        } else if (props.userTokens >= props.toolTokens) {
          total = systemCount + assistantCount + userCount + diff + toolCount
        } else {
          total = systemCount + assistantCount + userCount + toolCount + diff
        }
      }

      // System prompt blocks (white)
      for (let i = 0; i < Math.round((props.systemTokens / props.currentTokens) * filled); i++) {
        segments.push({ char: "█", color: props.systemColor || props.agentColor, type: "system" })
      }

      // Assistant blocks (primary color)
      for (let i = 0; i < Math.round((props.assistantTokens / props.currentTokens) * filled); i++) {
        segments.push({
          char: "█",
          color: props.assistantColor || props.agentColor,
          type: "assistant",
        })
      }

      // User blocks (secondary color)
      for (let i = 0; i < Math.round((props.userTokens / props.currentTokens) * filled); i++) {
        segments.push({ char: "█", color: props.userColor || props.agentColor, type: "user" })
      }

      // Tool blocks (accent color)
      const toolSegments = filled - segments.length + 1 // +1 for border we'll add
      for (let i = 0; i < toolSegments; i++) {
        segments.push({ char: "█", color: props.toolColor || props.agentColor, type: "tool" })
      }
    }

    // Empty segments
    for (let i = 0; i < empty; i++) {
      segments.push({ char: "░", color: props.agentColor, type: "empty" })
    }

    // Add right border
    segments.push({ char: "▌", color: props.agentColor, type: "border" })

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
          <text fg={props.systemColor || props.agentColor}>● System</text>
          <text fg={props.assistantColor || props.agentColor}>● AI</text>
          <text fg={props.userColor || props.agentColor}>● User</text>
          <text fg={props.toolColor || props.agentColor}>● Tool</text>
        </box>
      </box>
    </Show>
  )
}
