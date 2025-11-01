import { type Component, createMemo } from "solid-js"

export interface ContextUsageBarProps {
  currentTokens: number
  tokenLimit: number
  agentColor?: string
  className?: string
}

/**
 * Visual context usage indicator showing token usage as a segmented bar
 * Ported from Go TUI status component
 */
export const ContextUsageBar: Component<ContextUsageBarProps> = (props) => {
  const usagePercent = createMemo(() => {
    if (props.tokenLimit === 0) return 0
    return (props.currentTokens / props.tokenLimit) * 100
  })

  const barContent = createMemo(() => {
    const barLength = 20
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

  // Don't render if no limit
  if (props.tokenLimit === 0) {
    return null
  }

  return (
    <span
      class={props.className}
      style={{
        color: props.agentColor || "currentColor",
        "font-family": "monospace",
        "white-space": "nowrap",
      }}
    >
      {barContent()}
      {percentText()}
    </span>
  )
}
