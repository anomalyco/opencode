// undici's fetch defaults headersTimeout and bodyTimeout to 300s, which kills
// long-running sessions at the ~303s mark. The SDK client→server connection
// (blocking POST /session/:id/message) needs both disabled so the request can
// survive past 5 minutes. Bun's fetch has no such defaults, but it has its own
// per-request idle timeout that needs `timeout: false` to disable — see
// https://github.com/oven-sh/bun/issues/16682. That flag is a no-op under
// Node/undici, so it's set unconditionally below rather than branched.
//
// undici is a hard dependency, but we still import it lazily inside the guard
// so browser bundlers don't pull undici (and its node:* deps) into the bundle
// when the SDK is loaded in a non-Node environment.
//
// The promise is cached so concurrent first calls share a single Agent —
// without this, two parallel calls could each create and race to assign an
// Agent, leaving the loser orphaned (never closed).
type UndiciAgent = InstanceType<typeof import("undici").Agent>

const nodeDispatcher: Promise<UndiciAgent | null> =
  typeof process === "undefined" || !process.versions || process.versions.bun
    ? Promise.resolve(null)
    : import("undici").then(({ Agent }) => new Agent({ headersTimeout: 0, bodyTimeout: 0 }))

export async function nodeFetchWithDispatcher(req: Request) {
  const dispatcher = await nodeDispatcher
  // @ts-ignore Bun-specific per-request idle timeout, see comment above
  req.timeout = false
  if (!dispatcher) return fetch(req)
  return fetch(req, { dispatcher } as RequestInit)
}
