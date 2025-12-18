import { Log } from "@/util/log"

const log = Log.create({ service: "oauth.callback" })

const HTML_SUCCESS = `<!DOCTYPE html>
<html>
<head>
  <title>OpenCode - Authorization Successful</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a2e; color: #eee; }
    .container { text-align: center; padding: 2rem; }
    h1 { color: #4ade80; margin-bottom: 1rem; }
    p { color: #aaa; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Authorization Successful</h1>
    <p>You can close this window and return to OpenCode.</p>
  </div>
  <script>setTimeout(() => window.close(), 2000);</script>
</body>
</html>`

const HTML_ERROR = (error: string) => `<!DOCTYPE html>
<html>
<head>
  <title>OpenCode - Authorization Failed</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a2e; color: #eee; }
    .container { text-align: center; padding: 2rem; }
    h1 { color: #f87171; margin-bottom: 1rem; }
    p { color: #aaa; }
    .error { color: #fca5a5; font-family: monospace; margin-top: 1rem; padding: 1rem; background: rgba(248,113,113,0.1); border-radius: 0.5rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Authorization Failed</h1>
    <p>An error occurred during authorization.</p>
    <div class="error">${error}</div>
  </div>
</body>
</html>`

type PendingAuth = {
  resolve: (code: string) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

type ServerKey = `${number}:${string}`

type ServerState = {
  server?: ReturnType<typeof Bun.serve>
  pending: Map<string, PendingAuth>
}

function serverKey(port: number, pathname: string): ServerKey {
  return `${port}:${pathname}` as const
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms))
}

async function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    Bun.connect({
      hostname: "127.0.0.1",
      port,
      socket: {
        open(socket) {
          socket.end()
          resolve(true)
        },
        error() {
          resolve(false)
        },
        data() {},
        close() {},
      },
    }).catch(() => resolve(false))
  })
}

export namespace OAuthCallback {
  const servers = new Map<ServerKey, ServerState>()
  const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000

  export async function ensureRunning(opts: { port: number; pathname: string }): Promise<void> {
    const key = serverKey(opts.port, opts.pathname)
    const existing = servers.get(key)
    if (existing?.server) return

    const running = await isPortInUse(opts.port)
    if (running) {
      log.info("oauth callback port already in use", { port: opts.port, pathname: opts.pathname })
      servers.set(key, { server: undefined, pending: new Map() })
      return
    }

    const state: ServerState = { pending: new Map() }
    state.server = Bun.serve({
      port: opts.port,
      fetch(req) {
        const url = new URL(req.url)
        if (url.pathname !== opts.pathname) return new Response("Not found", { status: 404 })

        const code = url.searchParams.get("code")
        const stateParam = url.searchParams.get("state")
        const error = url.searchParams.get("error")
        const errorDescription = url.searchParams.get("error_description")

        log.info("oauth callback received", { port: opts.port, pathname: opts.pathname, hasCode: !!code, stateParam, error })

        if (error) {
          const errorMsg = errorDescription || error
          if (stateParam && state.pending.has(stateParam)) {
            const pending = state.pending.get(stateParam)!
            clearTimeout(pending.timeout)
            state.pending.delete(stateParam)
            pending.reject(new Error(errorMsg))
          }
          return new Response(HTML_ERROR(errorMsg), { headers: { "Content-Type": "text/html" } })
        }

        if (!code) {
          return new Response(HTML_ERROR("No authorization code provided"), {
            status: 400,
            headers: { "Content-Type": "text/html" },
          })
        }

        // Find pending auth by state, or fallback to single pending auth.
        let pending: PendingAuth | undefined
        let pendingKey: string | undefined
        if (stateParam && state.pending.has(stateParam)) {
          pending = state.pending.get(stateParam)!
          pendingKey = stateParam
        } else if (!stateParam && state.pending.size === 1) {
          const [k, v] = state.pending.entries().next().value as [string, PendingAuth]
          pending = v
          pendingKey = k
          log.info("oauth callback missing state; using single pending auth", { key: k })
        }

        if (!pending || !pendingKey) {
          const errorMsg = !stateParam
            ? "No state parameter provided and multiple pending authorizations"
            : "Unknown or expired authorization request"
          return new Response(HTML_ERROR(errorMsg), { status: 400, headers: { "Content-Type": "text/html" } })
        }

        clearTimeout(pending.timeout)
        state.pending.delete(pendingKey)
        pending.resolve(code)

        return new Response(HTML_SUCCESS, { headers: { "Content-Type": "text/html" } })
      },
    })

    servers.set(key, state)
    log.info("oauth callback server started", { port: opts.port, pathname: opts.pathname })
  }

  export async function waitForCallback(opts: { port: number; pathname: string; key: string; timeoutMs?: number }): Promise<string> {
    const key = serverKey(opts.port, opts.pathname)
    const state = servers.get(key)
    if (!state) throw new Error("OAuth callback server not initialized. Call ensureRunning() first.")

    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (state.pending.has(opts.key)) {
          state.pending.delete(opts.key)
          reject(new Error("OAuth callback timeout - authorization took too long"))
        }
      }, timeoutMs)

      state.pending.set(opts.key, { resolve, reject, timeout })
    })
  }

  export function cancelPending(opts: { port: number; pathname: string; key: string }): void {
    const key = serverKey(opts.port, opts.pathname)
    const state = servers.get(key)
    if (!state) return
    const pending = state.pending.get(opts.key)
    if (!pending) return
    clearTimeout(pending.timeout)
    state.pending.delete(opts.key)
    pending.reject(new Error("Authorization cancelled"))
  }

  export async function stop(opts: { port: number; pathname: string }): Promise<void> {
    const key = serverKey(opts.port, opts.pathname)
    const state = servers.get(key)
    if (!state) return
    state.server?.stop()
    state.server = undefined

    for (const [, pending] of state.pending) {
      clearTimeout(pending.timeout)
      pending.reject(new Error("OAuth callback server stopped"))
    }
    state.pending.clear()
    servers.delete(key)

    // give Bun time to release the port
    await sleep(10)
  }
}

