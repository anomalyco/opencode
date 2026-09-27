export type InvokeCall = { name: string; input: Record<string, string> }

const CLOSE_TAG = "</invoke>"

export function parseInvokeCalls(text: string): { cleanText: string; calls: InvokeCall[] } {
  const calls: InvokeCall[] = []
  const chunks: string[] = []
  let cursor = 0
  while (cursor < text.length) {
    const start = text.indexOf("<invoke", cursor)
    if (start === -1) {
      chunks.push(text.slice(cursor))
      break
    }
    chunks.push(text.slice(cursor, start))
    const end = text.indexOf(CLOSE_TAG, start)
    if (end === -1) {
      chunks.push(text.slice(start))
      break
    }
    const block = text.slice(start, end + CLOSE_TAG.length)
    const call = parseInvokeBlock(block)
    if (call) calls.push(call)
    else chunks.push(block)
    cursor = end + CLOSE_TAG.length
  }
  return { cleanText: chunks.join(""), calls }
}

function parseInvokeBlock(block: string): InvokeCall | undefined {
  const name = block.match(/<invoke\s+name="([^"]*)"/)?.[1]
  if (name === undefined) return undefined
  const input: Record<string, string> = {}
  for (const match of block.matchAll(/<parameter\s+name="([^"]*)"\s*>([\s\S]*?)<\/parameter>/g)) {
    input[match[1]] = match[2]
  }
  return { name, input }
}