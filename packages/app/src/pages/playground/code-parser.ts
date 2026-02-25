export type ParseResult = {
  complete: boolean
  code: string
  language: string
  title?: string
}

const FENCE_OPEN = /```(html?|htm|jsx|tsx)\s*\n/i
const FENCE_CLOSE = /\n```\s*$/

export function extractCodeBlock(text: string): ParseResult {
  const match = text.match(FENCE_OPEN)
  if (!match) return { complete: false, code: "", language: "" }

  const start = match.index! + match[0].length
  const rest = text.slice(start)
  const end = rest.search(FENCE_CLOSE)

  if (end < 0) {
    return {
      complete: false,
      code: rest,
      language: match[1].toLowerCase(),
      title: extractTitle(rest),
    }
  }

  const code = rest.slice(0, end)
  return {
    complete: true,
    code,
    language: match[1].toLowerCase(),
    title: extractTitle(code),
  }
}

export function extractTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>(.*?)<\/title>/i)
  if (match) return match[1].trim() || undefined
  return undefined
}

export function extractAllCodeBlocks(text: string): ParseResult[] {
  const results: ParseResult[] = []
  let remaining = text
  for (;;) {
    const match = remaining.match(FENCE_OPEN)
    if (!match) break
    const start = match.index! + match[0].length
    const rest = remaining.slice(start)
    const end = rest.search(FENCE_CLOSE)
    if (end < 0) {
      results.push({
        complete: false,
        code: rest,
        language: match[1].toLowerCase(),
        title: extractTitle(rest),
      })
      break
    }
    const code = rest.slice(0, end)
    results.push({
      complete: true,
      code,
      language: match[1].toLowerCase(),
      title: extractTitle(code),
    })
    remaining = rest.slice(end + rest.slice(end).match(FENCE_CLOSE)![0].length)
  }
  return results
}
