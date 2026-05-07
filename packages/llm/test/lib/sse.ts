/**
 * Helpers for building deterministic SSE bodies in tests.
 *
 * Inline template-literal SSE strings are hard to write and review when chunks
 * contain JSON; this helper accepts plain values and serializes them, so test
 * authors only think about the chunk shapes, not the wire format.
 */
export const sseEvents = (...chunks: ReadonlyArray<unknown>): string =>
  `${chunks.map(formatChunk).join("")}data: [DONE]\n\n`

const formatChunk = (chunk: unknown) => `data: ${typeof chunk === "string" ? chunk : JSON.stringify(chunk)}\n\n`

/**
 * Build an SSE body from already-serialized strings (used when the chunk shape
 * itself is part of what's being tested, e.g. malformed chunks).
 */
export const sseRaw = (...lines: ReadonlyArray<string>): string => lines.map((line) => `${line}\n\n`).join("")
