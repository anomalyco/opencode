export type Stream = {
  items: string[]
  bytes: number
  dropped: number
}

export function capChunk(data: string, maxBytes: number) {
  if (data.length <= maxBytes) return { value: data, trimmed: false }
  return { value: data.slice(data.length - maxBytes), trimmed: true }
}

export function createStream() {
  return {
    items: [],
    bytes: 0,
    dropped: 0,
  } satisfies Stream
}

export function pushStream(stream: Stream, data: string, maxBytes: number) {
  const next = capChunk(data, maxBytes)
  stream.items.push(next.value)
  stream.bytes += next.value.length
  if (next.trimmed) stream.dropped += 1

  while (stream.bytes > maxBytes && stream.items.length > 1) {
    const next = stream.items.shift()
    if (!next) break
    stream.bytes -= next.length
    stream.dropped += 1
  }
}

export function takeStream(stream: Stream, maxBytes: number, maxItems: number) {
  if (stream.items.length === 0) return ""
  let bytes = 0
  let count = 0
  let out = ""

  while (stream.items.length > 0 && count < maxItems) {
    const next = stream.items[0]
    if (!next) break
    if (count > 0 && bytes + next.length > maxBytes) break
    stream.items.shift()
    stream.bytes -= next.length
    out += next
    bytes += next.length
    count += 1
    if (bytes >= maxBytes) break
  }

  return out
}
