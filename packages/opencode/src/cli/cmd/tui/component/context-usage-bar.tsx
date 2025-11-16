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

  const barSegments = createMemo<Array<{ char: string; color: RGBA; type: string }>>(() => {
    const filled = filledCount()
    const length = barLength()
    const empty = length - filled
    const totalTokens = props.systemTokens + props.assistantTokens + props.userTokens + props.toolTokens

    const segments: Array<{ char: string; color: RGBA; type: string }> = []
    segments.push({ char: "▐", color: props.agentColor, type: "border" })

    if (filled > 0 && totalTokens > 0) {
      const categories = [
        { type: "system", tokens: props.systemTokens, color: props.systemColor || props.agentColor },
        { type: "assistant", tokens: props.assistantTokens, color: props.assistantColor || props.agentColor },
        { type: "user", tokens: props.userTokens, color: props.userColor || props.agentColor },
        { type: "tool", tokens: props.toolTokens, color: props.toolColor || props.agentColor },
      ]

      const counts = categories.map((category) => {
        const exact = (category.tokens / totalTokens) * filled
        return {
          ...category,
          exact,
          count: Math.max(0, Math.floor(exact)),
        }
      })

      let assigned = counts.reduce((sum, c) => sum + c.count, 0)
      let remaining = filled - assigned

      while (remaining > 0) {
        const next = counts
          .filter((category) => category.tokens > 0)
          .sort((a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)))[0]
        if (!next) break
        next.count++
        remaining--
      }

      counts.forEach((category) => {
        for (let i = 0; i < category.count; i++) {
          segments.push({ char: "█", color: category.color, type: category.type })
        }
      })
    }

    for (let i = 0; i < empty; i++) {
      segments.push({ char: "░", color: props.agentColor, type: "empty" })
    }

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
          <text fg={props.toolColor || props.agentColor}>● Tool/Cached</text>
        </box>
      </box>
    </Show>
  )
}
