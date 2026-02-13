/**
 * Local event bridge
 *
 * In local mode (SANDBOX_ENABLED=false), connects to the upstream SSE
 * (local OpenCode server or sandbox-agent) and feeds events into the
 * gateway's internal bus. Automatically reconnects on disconnect.
 *
 * This allows the frontend's SSE connection to the gateway to remain
 * stable while the upstream can switch between local OpenCode and
 * sandbox-agent transparently.
 */
import { broadcastGlobal } from "./bus.ts"
import { logJson } from "../lib/logging.ts"

let currentAbort: AbortController | null = null
let currentUrl: string | null = null

// Cache session → directory mapping so we can fix the directory on all events.
// Sandbox-agent wraps events with its own CWD as "directory", but the frontend
// SDK routes events by the project directory. We extract the real directory from
// session.created events and use it for all subsequent events in that session.
const sessionDirCache = new Map<string, string>()

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener("abort", () => { clearTimeout(timer); resolve() }, { once: true })
  })
}

async function readSseStream(
  res: Response,
  onEvent: (data: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const body = res.body
  if (!body) return

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (!signal.aborted) {
    const chunk = await reader.read().catch(() => null)
    if (!chunk || chunk.done) return

    buffer += decoder.decode(chunk.value, { stream: true })
    const parts = buffer.split("\n\n")
    buffer = parts.pop() || ""

    for (const part of parts) {
      const data = part
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n")
        .trim()
      if (data) onEvent(data)
    }
  }
}

/**
 * Start bridging events from an upstream SSE URL to the gateway bus.
 * Reconnects automatically on disconnect.
 */
export function startBridge(upstreamBase: string, extraHeaders?: Record<string, string>): void {
  // Already connected to this source
  if (currentUrl === upstreamBase && currentAbort && !currentAbort.signal.aborted) return

  stopBridge()

  const abort = new AbortController()
  currentAbort = abort
  currentUrl = upstreamBase

  const url = `${upstreamBase.replace(/\/+$/, "")}/global/event`
  logJson("info", { kind: "local-bridge.start", url })

  const run = async () => {
    while (!abort.signal.aborted) {
      try {
        const headers: Record<string, string> = {
          accept: "text/event-stream",
          "user-agent": "claxedo-gateway/1.0",
          ...extraHeaders,
        }

        const res = await fetch(url, { headers, signal: abort.signal })
        if (!res.ok || !res.body) {
          await sleep(1000, abort.signal)
          continue
        }

        logJson("info", { kind: "local-bridge.connected", url })

        await readSseStream(
          res,
          (data) => {
            try {
              const parsed = JSON.parse(data)
              const payload = parsed?.payload
              if (!payload) return
              // Skip upstream server lifecycle events — gateway emits its own
              if (payload.type === "server.connected" || payload.type === "server.heartbeat") return

              // Fix directory: sandbox-agent wraps events with its own CWD,
              // but the frontend routes by project directory. Extract the real
              // directory from session info and cache it per session.
              const props = payload.properties
              const info = props?.info
              const sessionId = props?.sessionID || info?.sessionID || info?.id

              // Cache directory from events that carry session info
              if (info?.directory && sessionId) {
                sessionDirCache.set(sessionId, info.directory)
              }

              // Use cached project directory instead of sandbox-agent CWD
              const directory =
                (sessionId && sessionDirCache.get(sessionId)) || parsed?.directory

              void broadcastGlobal({ directory, payload })
            } catch {
              // ignore malformed events
            }
          },
          abort.signal,
        )

        // Stream ended, reconnect
        logJson("info", { kind: "local-bridge.disconnected", url })
      } catch {
        if (abort.signal.aborted) return
      }
      await sleep(1000, abort.signal)
    }
  }

  void run()
}

/**
 * Stop the current bridge.
 */
export function stopBridge(): void {
  if (currentAbort) {
    currentAbort.abort()
    currentAbort = null
    currentUrl = null
  }
  sessionDirCache.clear()
}

/**
 * Switch the bridge to a new upstream. Stops the old one first.
 */
export function switchBridge(upstreamBase: string, extraHeaders?: Record<string, string>): void {
  stopBridge()
  startBridge(upstreamBase, extraHeaders)
}
