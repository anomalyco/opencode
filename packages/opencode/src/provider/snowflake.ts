const ROLE_ASSISTANT = /"role"\s*:\s*""/g

// A `"role":""` match can straddle a chunk boundary, so a per-chunk replace misses
// it. Hold back the longest suffix that is a prefix of `"role"\s*:\s*""` and only
// rewrite complete matches; the held tail is prepended to the next chunk and flushed
// on close. The hold window is 64 KiB: a whitespace gap larger than that is flushed
// un-rewritten rather than retaining an attacker-sized run (documented bound).
const ROLE_HOLD_MAX = 64 * 1024
const PARTIAL_ROLE = /^"role"\s*:?\s*"?$|^"(?:r(?:o(?:l(?:e"?)?)?)?)?$/

function partialTail(text: string): number {
  const start = Math.max(0, text.length - ROLE_HOLD_MAX)
  for (let index = start; index < text.length; index++) {
    if (text[index] !== '"') continue
    if (PARTIAL_ROLE.test(text.slice(index))) return text.length - index
  }
  return 0
}

function rewrite(text: string) {
  return text.includes('"role"') ? text.replace(ROLE_ASSISTANT, '"role":"assistant"') : text
}

export function rewriteSnowflakeRole(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ""
  return new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      const { done, value } = await reader.read()
      if (done) {
        buffer += decoder.decode()
        ctrl.enqueue(encoder.encode(rewrite(buffer)))
        ctrl.close()
        return
      }
      buffer += decoder.decode(value, { stream: true })
      const hold = partialTail(buffer)
      const head = buffer.slice(0, buffer.length - hold)
      buffer = buffer.slice(buffer.length - hold)
      ctrl.enqueue(encoder.encode(rewrite(head)))
    },
    cancel() {
      reader.cancel()
    },
  })
}

export * as Snowflake from "./snowflake"
