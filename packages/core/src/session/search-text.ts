export * as SessionSearchText from "./search-text.js"

import type { SessionMessage } from "./message.js"

/** Characters indexed per column. Longer text is nearly always a pasted log or file; its start is enough to find it. */
export const MaxText = 64 * 1024

export interface Fields {
  readonly summary: string
  readonly user_text: string
  readonly assistant_text: string
}

/** User text, assistant text parts or a completed compaction's summary; undefined when there is nothing to index. */
export const fromMessage = (message: SessionMessage.Info): Fields | undefined => {
  if (message.type === "user") return fields({ user_text: [message.text] })
  if (message.type === "assistant")
    return fields({ assistant_text: message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])) })
  if (message.type === "compaction" && message.status === "completed") return fields({ summary: [message.summary] })
  return undefined
}

/**
 * Appends the subwords of camelCase identifiers on a final line, so `decodeMessageRow` also matches `message` while
 * phrases stay adjacent. Acronyms stay whole (`XML Http Request`) and digits stay with letters (`base64 Encode`).
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
