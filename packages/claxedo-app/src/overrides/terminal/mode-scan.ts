const BRACKETED_ENABLE = "\u001b[?2004h"
const BRACKETED_DISABLE = "\u001b[?2004l"
const BRACKETED_PREFIX = "\u001b[?2004"

function tail(data: string, maxTail: number) {
  const index = data.lastIndexOf("\u001b")
  if (index === -1) return ""
  const out = data.slice(index)
  if (BRACKETED_ENABLE.startsWith(out) || BRACKETED_DISABLE.startsWith(out) || BRACKETED_PREFIX.startsWith(out)) {
    if (out.length <= maxTail) return out
  }
  return ""
}

export function createModeScanner(input?: { maxTail?: number }) {
  const maxTail = input?.maxTail ?? 32
  let bracketed = false
  let carry = ""

  return {
    scan(chunk: string) {
      if (!chunk && !carry) return bracketed
      const data = carry + chunk
      const re = /\x1b\[\?2004([hl])/g

      for (let match = re.exec(data); match; match = re.exec(data)) {
        bracketed = match[1] === "h"
      }

      carry = tail(data, maxTail)
      return bracketed
    },
    bracketed() {
      return bracketed
    },
    tail() {
      return carry
    },
  }
}
