import { Agent } from "undici"

// Node's undici fetch defaults both headersTimeout and bodyTimeout to 300s.
// This kills long-running provider requests — including SSE streams with gaps
// >300s between chunks — at the ~303s mark regardless of provider.timeout config.
//
// resolveTimeoutMs maps the provider `timeout` option to a millisecond value:
//   false      → 0 (disabled)
//   <number> >0 → that value (ms)
//   anything else → undefined (no dispatcher, undici defaults apply)
//
// createUndiciDispatcher wraps resolveTimeoutMs with a Node-only guard and
// constructs the Agent. Bun's fetch has no such defaults, so the guard via
// process.versions.bun keeps Bun behavior unchanged.
//
// This does not conflict with the existing chunkTimeout / headerTimeout abort
// signals: those use AbortSignal/AbortController which are independent of the
// undici dispatcher's socket-level timeouts.
export function resolveTimeoutMs(timeout: unknown): number | undefined {
  if (timeout === false) return 0
  if (typeof timeout === "number" && timeout > 0) return timeout
  return undefined
}

export function createUndiciDispatcher(timeout: unknown) {
  if (typeof process !== "object" || (process.versions as Record<string, string | undefined>).bun) return undefined
  const ms = resolveTimeoutMs(timeout)
  if (ms === undefined) return undefined
  return new Agent({ headersTimeout: ms, bodyTimeout: ms })
}
