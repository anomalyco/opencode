import type { Message } from "@opencode-ai/sdk/v2/client"
import type { Prompt } from "@/context/prompt"

type Item = {
  role: Message["role"]
  quote: string
  comment: string
}

const TITLE = "# Conversation Feedback"
const INTRO = "Please use the following annotated excerpts from the conversation when generating the next reply."

const block = (text: string) =>
  text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n")

export function exportMessageFeedback(items: Item[]) {
  if (items.length === 0) return ""

  return [
    TITLE,
    "",
    INTRO,
    "",
    ...items.flatMap((item, i) => [
      `## ${i + 1}. ${item.role} message`,
      "",
      "**Selected text**",
      "```",
      item.quote,
      "```",
      "",
      "**Comment**",
      block(item.comment),
      ...(i === items.length - 1 ? [] : [""]),
    ]),
  ].join("\n")
}

export function appendMessageFeedback(prompt: Prompt, markdown: string): Prompt {
  if (!markdown) {
    return prompt.map((part) => {
      if (part.type === "text") return { ...part }
      if (part.type === "image") return { ...part }
      if (part.type === "agent") return { ...part }
      return {
        ...part,
        selection: part.selection ? { ...part.selection } : undefined,
      }
    })
  }

  const content = prompt.some((part) => part.type === "text" && part.content.length > 0) ? `\n\n${markdown}` : markdown

  return [
    ...prompt.map((part) => {
      if (part.type === "text") return { ...part }
      if (part.type === "image") return { ...part }
      if (part.type === "agent") return { ...part }
      return {
        ...part,
        selection: part.selection ? { ...part.selection } : undefined,
      }
    }),
    {
      type: "text",
      content,
      start: 0,
      end: content.length,
    },
  ]
}
