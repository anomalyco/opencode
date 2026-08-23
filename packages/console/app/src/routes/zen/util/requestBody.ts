const TAIL_LIMIT = 4 * 1024
const encoder = new TextEncoder()

export async function prepareRequestBody(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  const decoder = new TextDecoder()
  let text = ""
  let done = false
  let searchFrom = 0
  let bom = 0
  let match: RegExpExecArray | null = null
  const pattern = /("model"\s*:\s*")([^"]+)"/g

  while (!done && !match) {
    const next = await reader.read()
    done = next.done
    if (!next.value) continue
    if (!chunks.length && next.value[0] === 0xef && next.value[1] === 0xbb && next.value[2] === 0xbf) bom = 3
    chunks.push(next.value)
    text += decoder.decode(next.value, { stream: true })
    pattern.lastIndex = searchFrom
    match = pattern.exec(text)
    searchFrom = Math.max(0, text.length - 256)
  }
  if (done) {
    text += decoder.decode()
    if (!match) {
      pattern.lastIndex = searchFrom
      match = pattern.exec(text)
    }
  }

  const found = (() => {
    if (!match) return
    const start = bom + utf8Length(text, match.index + match[1].length)
    return { model: match[2], start, end: start + utf8Length(match[2], match[2].length) }
  })()
  const preview = text.substring(0, 300)
  text = ""
  match = null
  let used = false

  return {
    model: found?.model ?? "",
    preview,
    cancel: () => reader.cancel(),
    stream(providerModel: string, includeUsage: boolean) {
      if (used) throw new Error("Request body stream already consumed")
      if (!found) throw new Error("Missing model field")
      used = true

      const initial = replace(chunks, found.start, found.end, providerModel)
      chunks.length = 0
      const output = passthrough(initial, reader, done)
      if (!includeUsage) return output
      return appendUsage(output)
    },
  }
}

function utf8Length(value: string, end: number) {
  let length = 0
  for (let i = 0; i < end; i++) {
    const code = value.charCodeAt(i)
    if (code <= 0x7f) length++
    else if (code <= 0x7ff) length += 2
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < end && value.charCodeAt(i + 1) >= 0xdc00) {
      length += 4
      i++
    } else length += 3
  }
  return length
}

function replace(chunks: Uint8Array[], start: number, end: number, value: string) {
  let offset = 0
  let inserted = false
  return chunks.flatMap((chunk) => {
    const chunkStart = offset
    const chunkEnd = offset + chunk.length
    offset = chunkEnd
    if (chunkEnd <= start || chunkStart >= end) return [chunk]

    const parts = [chunk.subarray(0, Math.max(0, start - chunkStart))]
    if (!inserted) {
      parts.push(encoder.encode(value))
      inserted = true
    }
    parts.push(chunk.subarray(Math.min(chunk.length, end - chunkStart)))
    return parts.filter((part) => part.length)
  })
}

function passthrough(
  initial: Array<Uint8Array | undefined>,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  sourceDone: boolean,
) {
  let done = sourceDone
  let index = 0
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const chunk = initial[index]
      if (chunk) {
        initial[index++] = undefined
        controller.enqueue(chunk)
        return
      }
      initial.length = 0
      if (done) {
        controller.close()
        return
      }
      const next = await reader.read()
      done = next.done
      if (next.value) controller.enqueue(next.value)
      if (done) controller.close()
    },
    cancel(reason) {
      initial.length = 0
      return reader.cancel(reason)
    },
  })
}

function appendUsage(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let tail = new Uint8Array()
  let streamText = ""
  let isStream = false
  const inspect = (chunk?: Uint8Array) => {
    streamText += chunk ? decoder.decode(chunk, { stream: true }) : decoder.decode()
    for (const match of streamText.matchAll(/"stream"\s*:\s*(true|false)/g)) isStream = match[1] === "true"
    streamText = streamText.slice(-64)
  }
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (true) {
        const next = await reader.read()
        if (next.done) {
          inspect()
          if (!isStream) {
            if (tail.length) controller.enqueue(tail)
            controller.close()
            return
          }
          const close = tail.lastIndexOf(125)
          if (close < 0) {
            controller.error(new Error("Invalid JSON request body"))
            return
          }
          if (close) controller.enqueue(tail.subarray(0, close))
          controller.enqueue(encoder.encode(',"stream_options":{"include_usage":true}}'))
          if (close + 1 < tail.length) controller.enqueue(tail.subarray(close + 1))
          controller.close()
          return
        }

        const chunk = next.value
        inspect(chunk)
        if (tail.length + chunk.length <= TAIL_LIMIT) {
          const combined = new Uint8Array(tail.length + chunk.length)
          combined.set(tail)
          combined.set(chunk, tail.length)
          tail = combined
          continue
        }

        const emit = tail.length + chunk.length - TAIL_LIMIT
        if (emit <= tail.length) {
          controller.enqueue(tail.subarray(0, emit))
          const combined = new Uint8Array(TAIL_LIMIT)
          combined.set(tail.subarray(emit))
          combined.set(chunk, tail.length - emit)
          tail = combined
          return
        }

        if (tail.length) controller.enqueue(tail)
        controller.enqueue(chunk.subarray(0, emit - tail.length))
        tail = chunk.slice(emit - tail.length)
        return
      }
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
}
