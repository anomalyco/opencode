import http from "node:http"

/**
 * Short-lived HTTP server that waits for a browser-based callback
 * (e.g. GitHub App installation redirect) and resolves a promise
 * when the browser hits the configured path.
 *
 * Binds on 127.0.0.1:0 so the OS picks a free port (no collisions).
 * No internal polling — the exposed `promise` resolves purely from
 * the inbound HTTP request.
 *
 * Usage:
 *   const server = startCallbackServer("/github-install-callback")
 *   const url = `http://127.0.0.1:${server.port}/github-install-callback`
 *   // open browser with redirect_uri=url
 *   await waitForCallback(server, { timeoutMs: 300_000 })
 */

const HTML_SUCCESS = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>opencode — Authorized</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #111;
      color: #eee;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      text-align: center;
      padding: 48px 40px;
      border-radius: 12px;
      border: 1px solid #333;
      background: #1a1a1a;
      max-width: 420px;
      width: 90%;
    }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h2 { color: #22c55e; margin-bottom: 12px; font-size: 22px; font-weight: 600; }
    p { color: #aaa; line-height: 1.6; }
    small { display: block; margin-top: 24px; color: #555; font-size: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#10003;</div>
    <h2>Authorized!</h2>
    <p>You may now return to the terminal.</p>
    <small>You can close this tab</small>
  </div>
</body>
</html>`

export interface CallbackServer {
  /** OS-assigned port the server is listening on. */
  readonly port: number
  /** Resolves when the browser hits the configured callback path. */
  readonly promise: Promise<void>
  /** Stops the server. Safe to call multiple times. */
  close(): void
}

export function startCallbackServer(path: string): CallbackServer {
  let _resolve!: () => void
  let _reject!: (err: Error) => void

  const _promise = new Promise<void>((res, rej) => {
    _resolve = res
    _reject = rej
  })
  // Suppress unhandled-rejection if nobody awaits before close()
  _promise.catch(() => {})

  let resolved = false

  const server = http.createServer((req, res) => {
    const port = (server.address() as { port: number } | null)?.port ?? 0
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`)

    if (url.pathname === path) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" })
      res.end(HTML_SUCCESS)
      if (!resolved) {
        resolved = true
        // Small delay lets the browser render the page before the socket closes
        setTimeout(() => {
          server.close()
          _resolve()
        }, 500)
      }
      return
    }

    res.writeHead(404)
    res.end("Not found")
  })

  server.listen(0, "127.0.0.1")
  server.on("error", (err) => _reject(err))

  return {
    get port() {
      return (server.address() as { port: number } | null)?.port ?? 0
    },
    get promise() {
      return _promise
    },
    close() {
      if (!resolved) {
        resolved = true
        _reject(new Error("Server closed before callback was received"))
      }
      server.close()
    },
  }
}

/**
 * Races `server.promise` against a timeout.
 * Rejects with an error if the timeout fires before the browser callback.
 */
export function waitForCallback(server: CallbackServer, opts: { timeoutMs?: number } = {}): Promise<void> {
  const ms = opts.timeoutMs ?? 300_000
  return Promise.race([
    server.promise,
    new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error(`GitHub app authorization timed out after ${ms / 1000}s`)), ms),
    ),
  ])
}