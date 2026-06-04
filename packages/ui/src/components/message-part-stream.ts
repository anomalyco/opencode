import type { Message } from "@opencode-ai/sdk/v2"

export function activeStreamingAssistantMessageID(messages: readonly Message[] | undefined) {
  let active: string | undefined
  for (const message of messages ?? []) {
    if (message.role !== "assistant") continue
    if (typeof message.time.completed === "number") continue
    active = message.id
  }
  return active
}

function fence(line: string) {
  const match = line.match(/^( {0,3})(`{3,}|~{3,})/)
  if (!match) return
  return match[2]
}

function stable(text: string) {
  let cut = -1
  let row = ""
  let code = ""
  let math = false

  const mark = (end: number) => {
    if (code || math) return
    if (!row.trim()) {
      cut = end
      return
    }
    if (/^(#{1,6}\s|>|\|)/.test(row)) {
      cut = end
      return
    }
    if (/^\s*(?:[-*+]\s|\d+\.\s)/.test(row)) {
      cut = end
      return
    }
    if (/^\s*[-*_]{3,}\s*$/.test(row)) {
      cut = end
      return
    }
    if (/^\$\$.*\$\$\s*$/.test(row.trim())) {
      cut = end
    }
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    row += ch
    if (ch !== "\n" && i !== text.length - 1) continue

    const line = row.endsWith("\n") ? row.slice(0, -1) : row
    const next = fence(line)
    if (next) {
      if (!code) {
        code = next[0]!
      } else if (line.trimStart().startsWith(code.repeat(next.length))) {
        code = ""
        cut = i + 1
      }
      row = ""
      continue
    }

    if (line.trim() === "$$") {
      math = !math
      if (!math) cut = i + 1
      row = ""
      continue
    }

    mark(i + 1)
    row = ""
  }

  if (code || math) return -1
  return cut
}

export function streamsplit(text: string) {
  const body = text.trim()
  if (!body) return { head: "", tail: "" }
  const cut = stable(body)
  if (cut <= 0 || cut >= body.length) return { head: "", tail: body }

  const head = body.slice(0, cut).trimEnd()
  const tail = body.slice(cut).trimStart()
  if (!head || !tail) return { head: body, tail: "" }
  return { head, tail }
}

const word = /[\p{L}\p{N}]/u
const min = 8

export function hold(text: string) {
  const body = text.trim()
  if (!body) return { head: "", tail: "" }
  const next = streamsplit(body)
  if (!next.head || !next.tail) return next
  if (next.tail.length < min) return { head: "", tail: body }
  if (!word.test(next.tail)) return { head: "", tail: body }
  return next
}
