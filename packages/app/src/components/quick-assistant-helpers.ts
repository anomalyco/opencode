import type { Message, Part } from "@opencode-ai/sdk/v2/client"

export function render(parts: Part[] | undefined) {
  if (!parts?.length) return ""
  return parts
    .map((part) => {
      if (part.type === "text") return part.text
      if (part.type === "reasoning") return part.text
      if (part.type === "tool") return `[tool] ${part.tool}`
      if (part.type === "file") return `[file] ${part.filename || part.url}`
      if (part.type === "agent") return `@${part.name}`
      return ""
    })
    .filter(Boolean)
    .join("\n")
    .trim()
}

export function mergeMessages(a: Message[] | undefined, b: Message[]) {
  return Array.from(
    [...(a ?? []), ...b].reduce(
      (map, item) => map.set(item.id, item),
      new Map<string, Message>(),
    ).values(),
  ).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}
