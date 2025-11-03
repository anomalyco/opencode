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
    if (props.tokenLimit <= 0 || props.currentTokens < 0) return 0
    const percent = (props.currentTokens / props.tokenLimit) * 100
    return Math.min(100, Math.max(0, percent)) // Clamp to 0-100
  })

  // Separate memos for each calculation step
  const barLength = createMemo(() => Math.max(15, (props.width || 40) - 11))

  const filledCount = createMemo(() => {
    const percent = usagePercent()
    const length = barLength()
    return Math.min(Math.floor((length * percent) / 100), length)
  })

  // Only recompute segments when filledCount or barLength actually changes
  const barSegments = createMemo<Array<{ char: string; color: RGBA }>>((prev) => {
    const filled = filledCount()
    const length = barLength()
    const empty = length - filled

    // Early return if nothing changed
    if (prev && prev.length === filled + empty + 2) {
      // +2 for borders
      return prev
    }

    const segments: Array<{ char: string; color: RGBA }> = []

    // Add left border
    segments.push({ char: "▐", color: props.agentColor })

    // Filled segments with color rotation (AI, Tool, User)
    for (let i = 0; i < filled; i++) {
      let color: RGBA
      switch (i % 3) {
        case 0:
          color = props.assistantColor || props.agentColor
          break
        case 1:
          color = props.toolColor || props.agentColor
          break
        case 2:
          color = props.userColor || props.agentColor
          break
        default:
          color = props.agentColor
      }
      segments.push({ char: "█", color })
    }

    // Empty segments
    for (let i = 0; i < empty; i++) {
      segments.push({ char: "░", color: props.agentColor })
    }

    // Add right border
    segments.push({ char: "▌", color: props.agentColor })

    return segments
  }, [])

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
