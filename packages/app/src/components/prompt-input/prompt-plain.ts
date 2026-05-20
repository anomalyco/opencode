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

export function promptFromDoc(text: string, context: Prompt): Prompt {
  const rest = context.filter((part) => part.type !== "text")
  const head: TextPart = { type: "text", content: text, start: 0, end: text.length }
  return [head, ...rest]
}
