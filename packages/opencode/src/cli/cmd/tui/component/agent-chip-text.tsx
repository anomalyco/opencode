import { For } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"

export type TextSegment = {
  type: "text" | "chip"
  content: string
  agentType?: string
}

/**
 * Parse text and extract agent chips in format [@AGENT] or @agent
 * Examples: "[@GENERAL] Fix bug" or "@orchestrator Design system"
 */
export function parseAgentChips(text: string): TextSegment[] {
  const segments: TextSegment[] = []
  // Match [@AGENT] or @agent (at word boundaries)
  const regex = /(\[@?(\w+)\]|@(\w+)\b)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    // Add text before match
    if (match.index > lastIndex) {
      segments.push({
        type: "text",
        content: text.substring(lastIndex, match.index),
      })
    }

    // Add chip (capture group 2 for [@AGENT], group 3 for @agent)
    const agentType = match[2] || match[3]
    segments.push({
      type: "chip",
      content: `@${agentType}`,
      agentType: agentType.toLowerCase(),
    })

    lastIndex = regex.lastIndex
  }

  // Add remaining text
  if (lastIndex < text.length) {
    segments.push({
      type: "text",
      content: text.substring(lastIndex),
    })
  }

  return segments.length > 0 ? segments : [{ type: "text", content: text }]
}

/**
 * Get agent color based on type
 */
export function getAgentChipColor(agentType: string, theme: any): string {
  const agent = agentType.toLowerCase()
  if (agent.includes("orchestrator")) return "#9370DB" // purple
  if (agent.includes("general")) return "#4169E1" // royal blue
  if (agent.includes("plan")) return "#20B2AA" // light sea green
  if (agent.includes("docs")) return "#FF8C00" // dark orange
  if (agent.includes("git")) return "#32CD32" // lime green
  return theme.accent // default
}

/**
 * Component that renders text with agent chips
 * Usage: <AgentChipText text="[@GENERAL] Fix the bug" />
 */
export function AgentChipText(props: { text: string; fg?: string; truncate?: number }) {
  const { theme } = useTheme()
  const segments = parseAgentChips(props.text)

  // Smart truncation: preserve chip, truncate only text after chip
  let finalSegments = segments
  if (props.truncate) {
    let currentLength = 0
    const truncatedSegments: TextSegment[] = []

    for (const segment of segments) {
      const segmentLength = segment.content.length

      if (currentLength + segmentLength <= props.truncate) {
        // Fits completely
        truncatedSegments.push(segment)
        currentLength += segmentLength
      } else if (segment.type === "chip") {
        // Always include chip even if it exceeds limit
        truncatedSegments.push(segment)
        currentLength += segmentLength
      } else {
        // Truncate text segment
        const remaining = props.truncate - currentLength
        if (remaining > 3) {
          truncatedSegments.push({
            type: "text",
            content: segment.content.substring(0, remaining - 3) + "...",
          })
        }
        break
      }
    }

    finalSegments = truncatedSegments
  }

  return (
    <box flexDirection="row" gap={0}>
      <For each={finalSegments}>
        {(segment) => {
          if (segment.type === "chip") {
            const chipColor = getAgentChipColor(segment.agentType!, theme)
            return (
              <>
                <text fg={props.fg || theme.text}> </text>
                <text fg={chipColor} attributes={TextAttributes.BOLD}>
                  [{segment.content}]
                </text>
                <text fg={props.fg || theme.text}> </text>
              </>
            )
          }
          return <text fg={props.fg || theme.text}>{segment.content}</text>
        }}
      </For>
    </box>
  )
}
