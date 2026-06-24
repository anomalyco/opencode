import { Agent } from "undici"

// undici's fetch defaults headersTimeout and bodyTimeout to 300s, which kills
// long-running sessions at the ~303s mark. The SDK client→server connection
// (blocking POST /session/:id/message) needs both disabled so the request can
// survive past 5 minutes. Bun is unaffected — its fetch has no such defaults.
const nodeDispatcher =
  typeof process === "undefined" || !process.versions || process.versions.bun
    ? undefined
    : new Agent({ headersTimeout: 0, bodyTimeout: 0 })

export async function nodeFetchWithDispatcher(req: Request) {
  if (!nodeDispatcher) return fetch(req)
  return fetch(req, { dispatcher: nodeDispatcher } as RequestInit)
}
