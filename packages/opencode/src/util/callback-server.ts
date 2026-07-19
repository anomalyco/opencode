/**
 * @fileOverview
 * @path: packages/opencode/src/util/callback-server.ts
 * @layer: SERVICE
 * @role: Short-lived HTTP server that waits for a browser OAuth/install callback
 * @owner: CLI
 */

/**
 * @dependencies
 * internal: none
 * external:
 * - node:http
 */

/**
 * @flow
 * startCallbackServer(path) -> binds on 127.0.0.1:0 (OS-assigned port)
 * -> caller opens browser with redirect_uri=http://127.0.0.1:{port}{path}
 * -> browser hits {path} after user completes auth
 * -> server serves HTML_SUCCESS, resolves internal promise
 * -> waitForCallback resolves (Promise.race with timeout)
 * -> caller calls server.close()
 */

/**
 * @performance
 * - Uses port 0 (OS-assigned) — no hard-coded port collision risk
 * - No polling; purely event-driven via Promise
 */

/**
 * @security
 * - Bound only to 127.0.0.1 — not reachable from outside localhost
 * - No CORS headers; no cross-origin access
 */

/**
 * @scalability
 * - Single-use server; closed immediately after callback fires
 */

/**
 * @verdict
 * status: CLEAN
 * priority: LOW
 */

import http from "node:http"

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
  /** The OS-assigned port the server is listening on. */
  readonly port: number
  /** A promise that resolves when the browser hits the callback path. */
  readonly promise: Promise<void>
  /** Shuts down the server. Safe to call multiple times. */
  close(): void
}

/**
 * Starts a short-lived HTTP server on 127.0.0.1 with an OS-assigned port.
 *
 * The server exposes a `promise` that resolves when the browser hits `path`.
 * The caller is responsible for including the callback URL in whatever link
 * it opens in the browser, e.g.:
 *   `http://127.0.0.1:${server.port}/github-install-callback`
 *
 * @param path - The URL path to listen on (e.g. "/github-install-callback")
 */
export function startCallbackServer(path: string): CallbackServer {
  let _resolve!: () => void
  let _reject!: (err: Error) => void
  // The promise that resolves when the real browser hits `path`.
  // No internal polling — this is purely event-driven.
  const _promise = new Promise<void>((res, rej) => {
    _resolve = res
    _reject = rej
  })
  // Prevent Node from crashing if nobody awaits the promise before the
  // server is closed externally (e.g. on SIGINT).
  _promise.catch(() => {})

  let resolved = false

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${currentPort()}`)

    if (url.pathname === path) {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      })
      res.end(HTML_SUCCESS)

      if (!resolved) {
        resolved = true
        // Give the browser 500ms to render before closing the server
        setTimeout(() => {
          server.close()
          _resolve()
        }, 500)
      }
      return
    }

    // Any other path → 404
    res.writeHead(404)
    res.end("Not found")
  })

  // Port 0 lets the OS pick a free port — no collision risk
  server.listen(0, "127.0.0.1")

  server.on("error", (err) => {
    _reject(err)
  })

  function currentPort(): number {
    const addr = server.address()
    return typeof addr === "object" && addr !== null ? addr.port : 0
  }

  return {
    get port() {
      return currentPort()
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
 * Returns a promise that resolves when the browser hits the callback server,
 * or rejects after `timeoutMs` (default: 5 minutes).
 *
 * No polling. Races `server.promise` against a timeout.
 */
export function waitForCallback(
  server: CallbackServer,
  opts: { timeoutMs?: number } = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 300_000
  return Promise.race([
    server.promise,
    new Promise<void>((_, reject) =>
      setTimeout(
        () => reject(new Error(`GitHub app authorization timed out after ${timeoutMs / 1000}s`)),
        timeoutMs,
      ),
    ),
  ])
}