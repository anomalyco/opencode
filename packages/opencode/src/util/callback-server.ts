/**
 * Minimal HTTP server utilities for receiving browser-based OAuth/callbacks.
 *
 * This module provides a way to wait for a user to complete a browser-based
 * flow (e.g. GitHub App installation) by running a short-lived HTTP server
 * that resolves a promise when the browser hits the callback URL.
 *
 * Usage:
 *   const { startCallbackServer, waitForCallback } = await import("@/util/callback-server")
 *   const server = startCallbackServer()
 *   const promise = waitForCallback(server, { path: "/callback", timeoutMs: 300_000 })
 *   // Open browser, user completes auth in browser
 *   await promise  // resolves when browser hits the callback
 *   server.close()
 */

import http from "node:http"

// Reusable free port range — try a few to avoid conflicts
const PORTS = [29734, 29735, 29736, 29737, 29738]
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

export interface CallbackOptions {
  /** URL path to listen on (e.g. "/github-install-callback") */
  path: string
  /** Timeout in milliseconds (default: 5 minutes) */
  timeoutMs?: number
}

/** A started HTTP server that can be used with waitForCallback() */
export interface CallbackServer {
  port: number
  close: () => void
}

type DeferredResolve = () => void
type DeferredReject = (err: Error) => void

/**
 * Starts an HTTP server on a port from the reusable range (29734–29738).
 * Returns a server that auto-responds with a success page on the configured path.
 */
export function startCallbackServer(): CallbackServer {
  let closed = false
  let resolvePromise: DeferredResolve | undefined
  let rejectPromise: DeferredReject | undefined

  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })

  // Prevent unhandled rejection when the server is closed before callback
  promise.catch(() => {})

  let currentPortIndex = 0

  function tryListen(server: http.Server) {
    const port = PORTS[currentPortIndex]
    server.listen(port, "127.0.0.1", () => {
      // resolved on first successful listen
    })
  }

  const server = http.createServer((req, res) => {
    if (closed) return

    const url = new URL(req.url ?? "/", `http://127.0.0.1:${server.address()?.port ?? 29734}`)

    if (url.pathname === "/github-install-callback") {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      })
      res.end(HTML_SUCCESS)

      if (!closed) {
        closed = true
        resolvePromise?.()
        // Give the browser a moment to render before closing
        setTimeout(() => server.close(), 500)
      }
      return
    }

    // Redirect unknown paths to the GitHub App install page
    res.writeHead(302, { Location: "https://github.com/apps/opencode-agent" })
    res.end()
  })

  // Try ports in sequence
  tryListen(server)

  // Expose close on server
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE" && currentPortIndex < PORTS.length - 1) {
      currentPortIndex++
      tryListen(server)
    } else {
      rejectPromise?.(err)
    }
  })

  return {
    get port() {
      const addr = server.address()
      return typeof addr === "object" && addr !== null ? addr.port : PORTS[currentPortIndex]
    },
    close() {
      closed = true
      server.close()
    },
  } as CallbackServer
}

/**
 * Returns a promise that resolves when the browser hits the configured path,
 * or rejects if the timeout is reached first.
 */
export function waitForCallback(server: CallbackServer, opts: CallbackOptions): Promise<void> {
  const { path, timeoutMs = 300_000 } = opts
  let timeout: NodeJS.Timeout

  return new Promise<void>((resolve, reject) => {
    timeout = setTimeout(() => {
      server.close()
      reject(new Error(`Callback timeout after ${timeoutMs}ms`))
    }, timeoutMs)

    // Poll the server port until it closes (meaning callback fired)
    const checkInterval = setInterval(() => {
      const req = http.get(
        `http://127.0.0.1:${server.port}${path}`,
        (res) => {
          clearInterval(checkInterval)
          clearTimeout(timeout)
          resolve()
        },
      )
      req.on("error", () => {
        // Server not ready yet, keep waiting
      })
    }, 500)

    // Also resolve if server closes on its own (callback fired)
    const originalClose = server.close.bind(server)
    server.close = () => {
      clearInterval(checkInterval)
      clearTimeout(timeout)
      resolve()
      originalClose()
    }
  })
}