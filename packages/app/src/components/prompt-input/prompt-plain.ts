import type { Prompt, TextPart } from "@/context/prompt"

export function promptPlain(parts: Prompt) {
  return parts
    .filter((part) => part.type === "text")
    .map((part) => part.content)
    .join("")
}

export function promptWithPlain(current: Prompt, text: string): Prompt {
  const rest = current.filter((part) => part.type !== "text")
  const head: TextPart = { type: "text", content: text, start: 0, end: text.length }
  return [head, ...rest]
}

export function promptFromDocMarkdown(text: string, context: Prompt, docID?: string): Prompt {
  const rest = context.filter((part) => part.type !== "text")
  const head: TextPart = { type: "text", content: text, start: 0, end: text.length, format: "markdown", source: "doc", docID }
  return [head, ...rest]
}
