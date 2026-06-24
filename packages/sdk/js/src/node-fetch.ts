// undici's fetch defaults headersTimeout and bodyTimeout to 300s, which kills
// long-running sessions at the ~303s mark. The SDK client→server connection
// (blocking POST /session/:id/message) needs both disabled so the request can
// survive past 5 minutes. Bun is unaffected — its fetch has no such defaults.
//
// undici is a hard dependency, but we still import it lazily inside the guard
// so browser bundlers don't pull undici (and its node:* deps) into the bundle
// when the SDK is loaded in a non-Node environment.
type UndiciAgent = InstanceType<typeof import("undici").Agent>

let nodeDispatcher: UndiciAgent | undefined | null

async function ensureDispatcher() {
  if (nodeDispatcher !== undefined) return nodeDispatcher
  if (typeof process === "undefined" || !process.versions || process.versions.bun) {
    nodeDispatcher = null
    return null
  }
  const { Agent } = await import("undici")
  nodeDispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0 })
  return nodeDispatcher
}

export async function nodeFetchWithDispatcher(req: Request) {
  const dispatcher = await ensureDispatcher()
  if (!dispatcher) return fetch(req)
  return fetch(req, { dispatcher } as RequestInit)
}
