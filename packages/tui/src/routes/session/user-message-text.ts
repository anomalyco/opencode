import type { Part, TextPart } from "@opencode-ai/sdk/v2"

/**
 * A text part injected by a plugin or a tool can opt into markdown rendering by
 * setting `metadata: { render: "markdown" }` on the part. Text a person typed
 * keeps rendering literally, so a prompt containing markdown syntax is echoed
 * back exactly as it was entered.
 */
export function isMarkdownPart(part: TextPart) {
  return part.metadata?.["render"] === "markdown"
}

/**
 * Splits the visible text of a user message into the literal body and the body
 * that opted into markdown. Synthetic parts stay hidden, matching the previous
 * behavior of the message bubble.
 */
export function splitUserMessageText(parts: Part[]) {
  const visible = parts.flatMap((part) =>
    part.type === "text" && !part.synthetic && part.text ? [part] : [],
  )
  return {
    text: visible.flatMap((part) => (isMarkdownPart(part) ? [] : [part.text])).join("\n\n"),
    markdown: visible
      .flatMap((part) => (isMarkdownPart(part) ? [part.text.trim()] : []))
      .filter(Boolean)
      .join("\n\n"),
  }
}
