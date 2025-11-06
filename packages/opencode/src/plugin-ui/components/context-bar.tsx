/**
 * ContextBar - Reusable component for displaying token usage
 * Used by plugins to show context/token information
 */

import { For, Show } from "solid-js"

export interface ContextBarProps {
  tokens: number
  tokenLimit: number
  systemTokens?: number
  assistantTokens?: number
  userTokens?: number
  toolTokens?: number
  cost?: number
  barWidth?: number
}

export function ContextBar(props: ContextBarProps) {
  const percentage = () => Math.round((props.tokens / props.tokenLimit) * 100)

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat().format(num)
  }

  const formatCost = (cost: number) => {
    return `$${cost.toFixed(4)}`
  }

  // Calculate bar segments
  const barSegments = () => {
    const barWidth = props.barWidth || 38
    const total = props.tokens
    if (total === 0) return []

    const segments: Array<{ char: string; color: string; count: number }> = []

    // System tokens - muted gray
    if (props.systemTokens) {
      const systemCount = Math.round((props.systemTokens / props.tokenLimit) * barWidth)
      if (systemCount > 0) {
        segments.push({ char: "█", color: "#6b7280", count: systemCount })
      }
    }

    // Assistant tokens - blue
    if (props.assistantTokens) {
      const assistantCount = Math.round((props.assistantTokens / props.tokenLimit) * barWidth)
      if (assistantCount > 0) {
        segments.push({ char: "█", color: "#3b82f6", count: assistantCount })
      }
    }

    // Tool tokens - green
    if (props.toolTokens) {
      const toolCount = Math.round((props.toolTokens / props.tokenLimit) * barWidth)
      if (toolCount > 0) {
        segments.push({ char: "█", color: "#10b981", count: toolCount })
      }
    }

    // User tokens - orange (theme accent)
    if (props.userTokens) {
      const userCount = Math.round((props.userTokens / props.tokenLimit) * barWidth)
      if (userCount > 0) {
        segments.push({ char: "█", color: "#f5a742", count: userCount })
      }
    }

    return segments
  }

  return (
    <box flexDirection="column" gap={0}>
      {/* Token usage bar */}
      <box flexDirection="row" paddingLeft={0} paddingRight={0}>
        <For each={barSegments()}>
          {(segment) => (
            <>
              {Array.from({ length: segment.count }).map(() => (
                <text fg={segment.color}>{segment.char}</text>
              ))}
            </>
          )}
        </For>
      </box>

      {/* Token count */}
      <text fg="#6b7280">{formatNumber(props.tokens)} tokens</text>

      {/* Percentage */}
      <text fg="#6b7280">{percentage()}% used</text>

      {/* Cost */}
      <Show when={props.cost !== undefined}>
        <text fg="#6b7280">{formatCost(props.cost!)} spent</text>
      </Show>
    </box>
  )
}
