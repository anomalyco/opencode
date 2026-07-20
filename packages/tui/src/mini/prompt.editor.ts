import type { RunPromptPart } from "./types"
import { realignPromptMentions } from "../prompt/mention"
import { parseSlashHead } from "../prompt/parse"

type Mention = Extract<RunPromptPart, { type: "file" | "agent" }>

export function resolveEditorSlashValue(text: string) {
  const head = parseSlashHead(text)
  if (!head || head.name.toLowerCase() !== "editor") {
    return text
  }

  return head.arguments
}

export function realignEditorPromptParts(content: string, parts: RunPromptPart[]): RunPromptPart[] {
  const matches = realignPromptMentions(
    content,
    parts.map((part) => {
      if (part.type !== "file" && part.type !== "agent") return
      return promptPartMention(part)
    }),
  )

  return parts.flatMap((part, index) => {
    if (part.type !== "file" && part.type !== "agent") return [part]
    const mention = promptPartMention(part)
    if (!mention?.text) return [part]
    const match = matches[index]
    return match ? [updatePromptPart(part, match.start, match.end, match.text)] : []
  })
}

function promptPartMention(part: Mention) {
  const source = part.type === "agent" ? part.source : part.source?.text
  if (!source) return
  return { start: source.start, end: source.end, text: source.value }
}

function updatePromptPart(part: Mention, start: number, end: number, text: string): Mention {
  if (part.type === "agent") {
    return {
      ...part,
      source: {
        start,
        end,
        value: text,
      },
    }
  }

  if (!part.source?.text) {
    return part
  }

  return {
    ...part,
    source: {
      ...part.source,
      text: {
        ...part.source.text,
        start,
        end,
        value: text,
      },
    },
  }
}
