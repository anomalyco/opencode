import { createMemo, createSignal, For, Show } from "solid-js"
import { Dialog, Button, Icon } from "@opencode-ai/ui"
import { useSync } from "@/context/sync"
import type { Message, Part, TextPart, ToolPart } from "@opencode-ai/sdk"

interface ContextTimelineDialogProps {
  sessionID: string
  open: boolean
  onClose: () => void
}

interface TimelineBlock {
  id: string
  type: "user" | "assistant" | "system" | "tool"
  timestamp: number
  title: string
  description: string
  details?: string[]
  cost?: number
  tokens?: {
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
}

export function ContextTimelineDialog(props: ContextTimelineDialogProps) {
  const sync = useSync()

  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])
  const parts = createMemo(() => sync.data.part)

  const timelineBlocks = createMemo((): TimelineBlock[] => {
    const blocks: TimelineBlock[] = []
    const msgList = messages()

    for (const message of msgList) {
      const messageParts = parts()[message.id] ?? []

      if (message.role === "user") {
        // Find text parts for user message
        const textParts = messageParts.filter((p): p is TextPart => p.type === "text" && !p.synthetic)
        const mainText = textParts[0]?.text || "User message"

        blocks.push({
          id: message.id,
          type: "user",
          timestamp: message.time.created,
          title: "User Input",
          description: mainText.length > 100 ? mainText.substring(0, 100) + "..." : mainText,
          details: textParts.length > 1 ? textParts.slice(1).map((p) => p.text) : undefined,
        })
      } else if (message.role === "assistant") {
        // Assistant message block
        const textParts = messageParts.filter((p): p is TextPart => p.type === "text" && !p.synthetic)
        const toolParts = messageParts.filter((p): p is ToolPart => p.type === "tool")
        const mainText = textParts[0]?.text || "Assistant response"

        blocks.push({
          id: message.id,
          type: "assistant",
          timestamp: message.time.created,
          title: "Assistant Response",
          description: mainText.length > 100 ? mainText.substring(0, 100) + "..." : mainText,
          cost: message.cost,
          tokens: message.tokens,
          details: [
            ...textParts.slice(1).map((p) => `Text: ${p.text.substring(0, 50)}...`),
            ...toolParts.map(
              (p) =>
                `Tool: ${p.tool} ${
                  p.state.status === "completed"
                    ? "✓"
                    : p.state.status === "error"
                      ? "✗"
                      : p.state.status === "running"
                        ? "⏳"
                        : "⏸"
                }`,
            ),
          ],
        })

        // Add individual tool blocks
        for (const toolPart of toolParts) {
          let toolDescription = `${toolPart.tool} (${toolPart.state.status})`
          let details: string[] = []

          if (toolPart.state.status === "completed") {
            const metadata = toolPart.state.metadata
            details = Object.entries(metadata || {}).map(
              ([key, value]) =>
                `${key}: ${typeof value === "string" ? value.substring(0, 50) : String(value)}${
                  typeof value === "string" && value.length > 50 ? "..." : ""
                }`,
            )
          } else if (toolPart.state.status === "error") {
            details = [toolPart.state.error || "Unknown error"]
          } else if (toolPart.state.status === "running") {
            details = [toolPart.state.title || "Running..."]
          }

          blocks.push({
            id: toolPart.id,
            type: "tool",
            timestamp: message.time.created + toolParts.indexOf(toolPart) * 1000, // Offset for ordering
            title: `Tool: ${toolPart.tool}`,
            description: toolDescription,
            details: details.length > 0 ? details : undefined,
          })
        }
      }
    }

    // Sort by timestamp
    return blocks.sort((a, b) => a.timestamp - b.timestamp)
  })

  const formatTimestamp = (timestamp: number) => {
    return new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
    }).format(new Date(timestamp))
  }

  const formatCurrency = (cost?: number) => {
    if (!cost) return ""
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 4,
    }).format(cost)
  }

  const formatTokens = (tokens?: TimelineBlock["tokens"]) => {
    if (!tokens) return ""
    const total = tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
    return `${total.toLocaleString()} tokens (I:${tokens.input}, O:${tokens.output}, R:${tokens.reasoning}, C:${tokens.cache.read + tokens.cache.write})`
  }

  const getBlockIcon = (type: TimelineBlock["type"]) => {
    switch (type) {
      case "user": return "avatar-square"
      case "assistant": return "robot"
      case "system": return "settings"
      case "tool": return "hammer"
      default: return "circle"
    }
  }
  }

  const getBlockColor = (type: TimelineBlock["type"]) => {
    switch (type) {
      case "user":
        return "text-blue-600"
      case "assistant":
        return "text-green-600"
      case "system":
        return "text-purple-600"
      case "tool":
        return "text-orange-600"
      default:
        return "text-gray-600"
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && props.onClose()}>
      <Dialog.Header class="flex items-center justify-between p-6 border-b border-border">
        <div>
          <Dialog.Title class="text-lg font-semibold text-text">Context Timeline</Dialog.Title>
          <Dialog.Description class="text-sm text-text-muted mt-1">
            Detailed breakdown of conversation flow and tool usage
          </Dialog.Description>
        </div>
        <Dialog.CloseButton />
      </Dialog.Header>

      <Dialog.Body class="p-6 max-h-[600px] overflow-y-auto">
        <Show
          when={timelineBlocks().length > 0}
          fallback={
            <div class="text-center py-8 text-text-muted">
              <Icon name="clock" class="size-8 mx-auto mb-2 opacity-50" />
              <p>No timeline data available</p>
            </div>
          }
        >
          <div class="space-y-4">
            <For each={timelineBlocks()}>
              {(block, index) => (
                <div class="relative">
                  {/* Timeline line */}
                  <Show when={index() < timelineBlocks().length - 1}>
                    <div class="absolute left-4 top-8 w-0.5 h-6 bg-border" />
                  </Show>

                  <div class="flex gap-4">
                    {/* Icon */}
                    <div
                      class={`flex-shrink-0 w-8 h-8 rounded-full border-2 border-border bg-background flex items-center justify-center ${getBlockColor(block.type)}`}
                    >
                      <Icon name={getBlockIcon(block.type)} class="size-4" />
                    </div>

                    {/* Content */}
                    <div class="flex-1 min-w-0">
                      <div class="bg-background-weak rounded-lg p-4 border border-border">
                        {/* Header */}
                        <div class="flex items-start justify-between mb-2">
                          <div class="flex-1">
                            <h4 class={`font-medium text-sm ${getBlockColor(block.type)}`}>{block.title}</h4>
                            <p class="text-xs text-text-muted">{formatTimestamp(block.timestamp)}</p>
                          </div>
                          <div class="text-xs text-text-muted text-right">
                            <Show when={block.cost}>
                              <div>{formatCurrency(block.cost)}</div>
                            </Show>
                            <Show when={block.tokens}>
                              <div class="mt-1">{formatTokens(block.tokens)}</div>
                            </Show>
                          </div>
                        </div>

                        {/* Description */}
                        <p class="text-sm text-text mb-3 leading-relaxed break-words">{block.description}</p>

                        {/* Details */}
                        <Show when={block.details && block.details.length > 0}>
                          <div class="space-y-2">
                            <h5 class="text-xs font-medium text-text-muted uppercase tracking-wide">Details</h5>
                            <div class="space-y-1">
                              <For each={block.details}>
                                {(detail) => (
                                  <div class="text-xs text-text-muted bg-background rounded p-2 font-mono break-words">
                                    {detail}
                                  </div>
                                )}
                              </For>
                            </div>
                          </div>
                        </Show>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Dialog.Body>
    </Dialog>
  )
}
