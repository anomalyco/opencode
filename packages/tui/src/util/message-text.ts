import type { Part } from "@opencode-ai/sdk/v2"

export function messageText(parts: readonly Part[]) {
  return parts.flatMap((part) => (part.type === "text" && !part.synthetic && part.text ? [part.text] : [])).join("\n\n")
}
