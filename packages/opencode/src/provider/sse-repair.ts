import { jsonrepair } from "jsonrepair"
import * as Log from "@opencode-ai/core/util/log"

// Some OpenAI-compatible endpoints (observed with Z.AI GLM-5.1) occasionally echo
// hallucinated SSE fragments as plain text inside the `content` field without
// escaping the embedded quotes. The outer JSON becomes malformed and the AI SDK's
// parseJsonEventStream rejects the whole chunk, tearing down the entire stream.
//
// This module patches SSE responses at the byte layer: we split the body on the
// SSE event boundary (`\n\n`), try to strictly parse every `data:` payload, and
// only when that fails we ask `jsonrepair` to recover it. Valid payloads pass
// through byte-for-byte; unrepairable payloads are forwarded unchanged so the
// downstream parser still surfaces the original error.

const log = Log.create({ service: "provider/sse-repair" })

// Walks one SSE event block and rewrites the `data:` lines whose payload can be
// rescued by jsonrepair. Exported so unit tests can hit it without mocking a
// streaming Response.
export function repairSSEEvent(event: string): string {
  const lines = event.split("\n")
  let changed = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // SSE field names other than `data:` (event / id / retry / comment) never
    // carry JSON so we never touch them.
    if (!line.startsWith("data:")) continue

    // Preserve the exact amount of whitespace between `data:` and the payload
    // so a repaired event stays byte-compatible with the original framing.
    const after = line.slice(5)
    const leading = after.match(/^\s*/)?.[0] ?? ""
    const payload = after.slice(leading.length)
    if (!payload || payload === "[DONE]") continue

    // Fast path: the overwhelming majority of chunks are already valid JSON.
    // We only pay the jsonrepair cost on failure.
    try {
      JSON.parse(payload)
      continue
    } catch {}

    try {
      const repaired = jsonrepair(payload)
      // jsonrepair is aggressive and occasionally returns syntactically valid
      // but semantically odd JSON, so we round-trip through JSON.parse to make
      // sure the replacement is actually parseable before committing to it.
      JSON.parse(repaired)
      lines[i] = "data:" + leading + repaired
      changed = true
      log.warn("sse chunk repaired", { preview: payload.slice(0, 200) })
    } catch {
      // Leave the line untouched so the AI SDK still sees the original error
      // rather than a silently swallowed chunk.
    }
  }
  return changed ? lines.join("\n") : event
}

// Wraps a streaming Response so each `data:` payload is repaired in-flight.
// No-ops on non-SSE responses (identity is returned, helpful for tests and
// caller short-circuit checks).
export function repairSSE(res: Response): Response {
  if (!res.body) return res
  if (!res.headers.get("content-type")?.includes("text/event-stream")) return res

  const decoder = new TextDecoder("utf-8")
  const encoder = new TextEncoder()
  // Buffer straddles TCP/chunk boundaries; SSE events can be split across many
  // underlying Uint8Arrays, so we only emit once we see a full `\n\n`.
  let buffer = ""

  const transformed = res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true })
        while (true) {
          const idx = buffer.indexOf("\n\n")
          if (idx === -1) break
          const event = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)
          controller.enqueue(encoder.encode(repairSSEEvent(event) + "\n\n"))
        }
      },
      flush(controller) {
        // Drain any remaining bytes (servers that forget the trailing `\n\n`).
        buffer += decoder.decode()
        if (buffer.length) {
          controller.enqueue(encoder.encode(repairSSEEvent(buffer)))
          buffer = ""
        }
      },
    }),
  )

  return new Response(transformed, {
    headers: new Headers(res.headers),
    status: res.status,
    statusText: res.statusText,
  })
}
