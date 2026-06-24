import { Agent } from "undici"

// Node's undici fetch defaults both headersTimeout and bodyTimeout to 300s.
// This kills long-running provider requests — including SSE streams with gaps
// >300s between chunks — at the ~303s mark regardless of provider.timeout config.
//
// createUndiciDispatcher maps the provider `timeout` option to undici's
// headersTimeout AND bodyTimeout so that:
//   timeout: false      → both set to 0 (disabled)
//   timeout: <number>   → both set to that value (ms)
//   timeout: undefined  → no dispatcher (undici defaults apply, i.e. 300s)
//
// The dispatcher is only created under Node. Bun's fetch has no such defaults,
// so the guard via process.versions.bun keeps Bun behavior unchanged.
//
// This does not conflict with the existing chunkTimeout / headerTimeout abort
// signals: those use AbortSignal/AbortController which are independent of the
// undici dispatcher's socket-level timeouts.
export function createUndiciDispatcher(timeout: unknown) {
  if (typeof process !== "object" || (process.versions as Record<string, string | undefined>).bun) return undefined
  const ms = timeout === false ? 0 : typeof timeout === "number" && timeout > 0 ? timeout : undefined
  if (ms === undefined) return undefined
  return new Agent({ headersTimeout: ms, bodyTimeout: ms })
}
