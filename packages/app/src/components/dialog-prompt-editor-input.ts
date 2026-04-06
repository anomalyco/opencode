const PAIRS: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
  '"': '"',
  "'": "'",
  "`": "`",
  $: "$",
}

const CLOSERS = new Set(Object.values(PAIRS))

type Pair = {
  text: string
  start: number
  end: number
  key: string
}

type Edit = {
  text: string
  start: number
  end: number
}

export function pair(input: Pair) {
  const open = PAIRS[input.key]
  const prev = input.text[input.start - 1]
  const next = input.text[input.end]

  if (input.key === "Backspace" && input.start === input.end) {
    if (prev && next && PAIRS[prev] === next) {
      return {
        text: input.text.slice(0, input.start - 1) + input.text.slice(input.end + 1),
        start: input.start - 1,
        end: input.start - 1,
      } satisfies Edit
    }
    return null
  }

  if (open) {
    if (input.key === open && input.start === input.end && next === open) {
      return {
        text: input.text,
        start: input.start + 1,
        end: input.start + 1,
      } satisfies Edit
    }

    const body = input.text.slice(input.start, input.end)
    return {
      text: input.text.slice(0, input.start) + input.key + body + open + input.text.slice(input.end),
      start: input.start + 1,
      end: input.start + 1 + body.length,
    } satisfies Edit
  }

  if (CLOSERS.has(input.key) && input.start === input.end && next === input.key) {
    return {
      text: input.text,
      start: input.start + 1,
      end: input.start + 1,
    } satisfies Edit
  }

  return null
}

export function at(text: string, pos: number) {
  const match = text.slice(0, pos).match(/@(\S*)$/)
  if (!match) return
  return {
    start: pos - match[0].length,
    end: pos,
    query: match[1] ?? "",
  }
}

export function mention(text: string, start: number, end: number, path: string) {
  const tail = text.slice(end)
  const space = tail.startsWith(" ") || tail.startsWith("\n") || tail.length === 0 ? "" : " "
  const content = "@" + path + space
  const pos = start + content.length
  return {
    text: text.slice(0, start) + content + text.slice(end),
    start: pos,
    end: pos,
  } satisfies Edit
}
