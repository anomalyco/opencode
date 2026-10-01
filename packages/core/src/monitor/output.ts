export * as MonitorOutput from "./output.js"

export const MAX_BYTES = 256 * 1024
export const EVENT_BYTES = 16 * 1024

// Bound bytes before decoding, including partial lines and output awaiting delivery.
export function make() {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  const lines: string[] = []
  let partial = ""
  let bytes = 0
  let decodedBytes = 0
  let exceeded = false

  function append(text: string) {
    decodedBytes += encoder.encode(text).length
    if (decodedBytes > MAX_BYTES) {
      exceeded = true
      return
    }
    const parts = (partial + text).split("\n")
    partial = parts.pop() ?? ""
    for (const part of parts) {
      const line = part.endsWith("\r") ? part.slice(0, -1) : part
      if (encoder.encode(line).length + 1 > EVENT_BYTES) {
        exceeded = true
        break
      }
      lines.push(line)
    }
    if (encoder.encode(partial).length + 1 > EVENT_BYTES) exceeded = true
  }

  return {
    get bytes() {
      return bytes
    },
    get exceeded() {
      return exceeded
    },
    get pending() {
      return lines.length > 0
    },
    write(chunk: Uint8Array) {
      if (exceeded) return
      if (bytes + chunk.length > MAX_BYTES) {
        exceeded = true
        return
      }
      bytes += chunk.length
      append(decoder.decode(chunk, { stream: true }))
    },
    take(final = false) {
      if (final && !exceeded) {
        append(decoder.decode())
        if (!exceeded && partial) lines.push(partial.endsWith("\r") ? partial.slice(0, -1) : partial)
        partial = ""
      }
      const batches: string[][] = []
      let batch: string[] = []
      let size = 0
      for (const line of lines.splice(0)) {
        const length = encoder.encode(line).length + 1
        if (size + length > EVENT_BYTES) {
          batches.push(batch)
          batch = []
          size = 0
        }
        batch.push(line)
        size += length
      }
      if (batch.length > 0) batches.push(batch)
      return batches
    },
  }
}
