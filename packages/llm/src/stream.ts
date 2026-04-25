import { Stream } from "effect"
import type { HttpClientResponse } from "effect/unstable/http"

const splitEvents = (buffer: string, chunk: string) => {
  const events: string[] = []
  let rest = `${buffer}${chunk}`
  let boundary = eventBoundary(rest)

  while (boundary) {
    events.push(rest.slice(0, boundary.index))
    rest = rest.slice(boundary.index + boundary.length)
    boundary = eventBoundary(rest)
  }

  return [rest, events] as const
}

const eventBoundary = (value: string) => {
  const lineFeed = value.indexOf("\n\n")
  const crlf = value.indexOf("\r\n\r\n")
  if (lineFeed === -1) return crlf === -1 ? undefined : { index: crlf, length: 4 }
  if (crlf === -1) return { index: lineFeed, length: 2 }
  return lineFeed < crlf ? { index: lineFeed, length: 2 } : { index: crlf, length: 4 }
}

const eventData = (event: string) => {
  let data = ""
  let index = 0

  while (index <= event.length) {
    const next = event.indexOf("\n", index)
    const end = next === -1 ? event.length : next
    const line = event.slice(index, event[end - 1] === "\r" ? end - 1 : end)
    if (line.startsWith("data:")) {
      data += `${data.length === 0 ? "" : "\n"}${line.slice("data:".length).replace(/^ /, "")}`
    }
    if (next === -1) return data
    index = next + 1
  }

  return data
}

export const sseData = <E>(
  response: HttpClientResponse.HttpClientResponse,
  onError: (error: unknown) => E,
): Stream.Stream<string, E> =>
  response.stream.pipe(
    Stream.mapError(onError),
    Stream.decodeText(),
    Stream.mapAccum(() => "", splitEvents, {
      onHalt: (buffer) => (buffer.length === 0 ? [] : [buffer]),
    }),
    Stream.map(eventData),
    Stream.filter((data) => data.length > 0 && data !== "[DONE]"),
  )

export * as LLMStream from "./stream"
