import type { SessionMessageInfo } from "@opencode-ai/client"

type MessageChild = {
  readonly id?: string
  readonly y: number
}

export function messageNavigationSlack(input: {
  top: number
  viewportHeight: number
  scrollHeight: number
  currentSlack: number
}) {
  const contentHeight = input.scrollHeight - input.currentSlack
  return Math.max(0, Math.ceil(input.top + input.viewportHeight - contentHeight))
}

export function findMessageBoundary(input: {
  direction: "next" | "prev"
  children: readonly MessageChild[]
  messages: readonly SessionMessageInfo[]
  scrollTop: number
  viewportY: number
  currentID?: string
  userOnly?: boolean
}) {
  const messages = new Map(input.messages.map((message) => [message.id, message]))
  const visible = input.children
    .flatMap((child) => {
      if (!child.id) return []
      const message = messages.get(child.id)
      if (!message) return []
      if (message.type === "user" && message.text.trim()) {
        const y = input.scrollTop + child.y - input.viewportY
        return [{ id: child.id, y, top: y }]
      }
      if (input.userOnly || message.type !== "assistant") return []
      if (!message.content.some((content) => content.type === "text" && content.text.trim())) return []
      const y = input.scrollTop + child.y - input.viewportY
      return [{ id: child.id, y, top: Math.max(0, y - 1) }]
    })
    .sort((a, b) => a.y - b.y)

  const current = visible.findIndex((child) => child.id === input.currentID)
  if (current !== -1) return visible[current + (input.direction === "next" ? 1 : -1)] ?? null
  if (input.direction === "next") return visible.find((child) => child.y > input.scrollTop) ?? null
  return visible.findLast((child) => child.y < input.scrollTop) ?? null
}
