import type { RunPromptPart } from "./types"

type Mention = Extract<RunPromptPart, { type: "file" | "agent" }>

export function resolveEditorSlashValue(text: string) {
  const head = slashHead(text)
  if (!head || head.name.toLowerCase() !== "editor") {
    return text
  }

  return head.arguments
}

export function realignEditorPromptParts(content: string, parts: RunPromptPart[]): RunPromptPart[] {
  const matches = new Map<number, Mention | undefined>()
  const used: Array<{ start: number; end: number }> = []

  for (const [index, part] of parts.entries()) {
    if (part.type !== "file" && part.type !== "agent") {
      continue
    }

    const text = promptPartText(part)
    if (!text) {
      continue
    }

    const start = findPromptPartIndex(content, text, used, promptPartStart(part))
    if (start === -1) {
      matches.set(index, undefined)
      continue
    }

    const end = start + text.length
    used.push({ start, end })
    matches.set(index, updatePromptPart(part, start, end, text))
  }

  const next: RunPromptPart[] = []
  for (const [index, part] of parts.entries()) {
    if (part.type !== "file" && part.type !== "agent") {
      next.push(part)
      continue
    }

    if (!promptPartText(part)) {
      next.push(part)
      continue
    }

    const match = matches.get(index)
    if (match) {
      next.push(match)
    }
  }

  return next
}

function slashHead(text: string) {
  if (!text.startsWith("/")) {
    return
  }

  for (let i = 1; i < text.length; i++) {
    switch (text[i]) {
      case " ":
      case "\t":
      case "\n":
        return {
          name: text.slice(1, i),
          arguments: text.slice(i + 1),
        }
    }
  }

  return {
    name: text.slice(1),
    arguments: "",
  }
}

function promptPartText(part: Mention) {
  if (part.type === "agent") {
    return part.source?.value
  }

  return part.source?.text.value
}

function promptPartStart(part: Mention) {
  if (part.type === "agent") {
    return part.source?.start ?? Number.POSITIVE_INFINITY
  }

  return part.source?.text.start ?? Number.POSITIVE_INFINITY
}

function findPromptPartIndex(content: string, text: string, used: Array<{ start: number; end: number }>, hint: number) {
  let searchFrom = 0
  let best = -1
  let distance = Number.POSITIVE_INFINITY
  const hinted = Number.isFinite(hint)

  while (true) {
    const start = content.indexOf(text, searchFrom)
    if (start === -1) {
      return best
    }

    const end = start + text.length
    searchFrom = start + 1
    if (used.some((range) => start < range.end && end > range.start)) {
      continue
    }

    if (!hinted) {
      return start
    }

    const nextDistance = Math.abs(start - hint)
    if (nextDistance < distance) {
      best = start
      distance = nextDistance
    }
  }
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
