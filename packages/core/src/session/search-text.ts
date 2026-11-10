export * as SessionSearchText from "./search-text.js"

import type { SessionMessage } from "./message.js"

/**
 * Characters of each column that are indexed. Messages past it are nearly always pasted logs, files or dumps, which
 * bloat the index and stall the batch that writes them; their first part is enough to find them.
 */
export const MaxText = 64 * 1024

/** The searchable text of one message, one value per indexed column. */
export interface Fields {
  readonly summary: string
  readonly user_text: string
  readonly assistant_text: string
}

/**
 * The searchable text of one message: what the user typed, the assistant's visible text parts, or a completed
 * compaction's summary. Tool calls and results, reasoning, attachments, and synthetic, system and skill messages are
 * left out. Returns undefined when the message has nothing to index. Each field is passed through {@link expand}.
 */
export const fromMessage = (message: SessionMessage.Info): Fields | undefined => {
  if (message.type === "user") return fields({ user_text: [message.text] })
  if (message.type === "assistant")
    return fields({ assistant_text: message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])) })
  if (message.type === "compaction" && message.status === "completed") return fields({ summary: [message.summary] })
  return undefined
}

/**
 * Keeps the text verbatim and appends the subwords of its camelCase and PascalCase words on a final line, so
 * `decodeMessageRow` also matches `message` while phrases in the original text stay adjacent. Acronyms stay whole
 * (`XMLHttpRequest` -> `XML Http Request`) and digits stay with the letters before them (`base64Encode` ->
 * `base64 Encode`). Stemming and case folding are left to the SQLite tokenizer.
 */
export const expand = (text: string) => {
  const subwords = Array.from(text.matchAll(WORD)).flatMap((match) => {
    const parts = match[0].split(BOUNDARY)
    return parts.length > 1 ? parts : []
  })
  return subwords.length === 0 ? text : `${text}\n${subwords.join(" ")}`
}

const WORD = /[\p{L}\p{M}\p{N}]+/gu
const BOUNDARY = /(?<=\p{Ll})(?=\p{Lu})|(?<=[\p{Lu}\p{N}])(?=\p{Lu}\p{Ll})/u

const fields = (input: { [K in keyof Fields]?: ReadonlyArray<string> }): Fields | undefined => {
  const result = {
    summary: join(input.summary),
    user_text: join(input.user_text),
    assistant_text: join(input.assistant_text),
  }
  if (result.summary === "" && result.user_text === "" && result.assistant_text === "") return undefined
  return result
}

const join = (texts: ReadonlyArray<string> = []) =>
  expand(
    texts
      .filter((text) => text.trim() !== "")
      .join("\n\n")
      .slice(0, MaxText),
  )
