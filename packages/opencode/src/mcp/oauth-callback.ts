import { createConnection } from "net"
import { createServer } from "http"
import * as Log from "@opencode-ai/core/util/log"
import { OAUTH_CALLBACK_PORT, OAUTH_CALLBACK_PATH, parseRedirectUri } from "./oauth-provider"

const log = Log.create({ service: "mcp.oauth-callback" })

// Current callback server configuration (may differ from defaults if custom redirectUri is used)
let currentPort = OAUTH_CALLBACK_PORT
let currentPath = OAUTH_CALLBACK_PATH

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

interface PendingAuth {
  resolve: (code: string) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

let server: ReturnType<typeof createServer> | undefined
const pendingAuths = new Map<string, PendingAuth>()
// Reverse index: mcpName → oauthState, so cancelPending(mcpName) can
// find the right entry in pendingAuths (which is keyed by oauthState).
const mcpNameToState = new Map<string, string>()

const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

function cleanupStateIndex(oauthState: string) {
  for (const [name, state] of mcpNameToState) {
    if (state === oauthState) {
      mcpNameToState.delete(name)
      break
    }
  }
}

function handleRequest(req: import("http").IncomingMessage, res: import("http").ServerResponse) {
  const url = new URL(req.url || "/", `http://localhost:${currentPort}`)

  if (url.pathname !== currentPath) {
    res.writeHead(404)
    res.end("Not found")
    return
  }

  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  const error = url.searchParams.get("error")
  const errorDescription = url.searchParams.get("error_description")

  log.info("received oauth callback", { hasCode: !!code, state, error })

  // Enforce state parameter presence
  if (!state) {
    const errorMsg = "Missing required state parameter - potential CSRF attack"
    log.error("oauth callback missing state parameter", { url: url.toString() })
    res.writeHead(400, { "Content-Type": "text/html" })
    res.end(HTML_ERROR(errorMsg))
    return
  }

  if (error) {
    const errorMsg = errorDescription || error
    if (pendingAuths.has(state)) {
      const pending = pendingAuths.get(state)!
      clearTimeout(pending.timeout)
      pendingAuths.delete(state)
      cleanupStateIndex(state)
      pending.reject(new Error(errorMsg))
    }
    res.writeHead(200, { "Content-Type": "text/html" })
    res.end(HTML_ERROR(errorMsg))
    return
  }

  if (!code) {
    res.writeHead(400, { "Content-Type": "text/html" })
    res.end(HTML_ERROR("No authorization code provided"))
    return
  }

  // Validate state parameter
  if (!pendingAuths.has(state)) {
    const errorMsg = "Invalid or expired state parameter - potential CSRF attack"
    log.error("oauth callback with invalid state", { state, pendingStates: Array.from(pendingAuths.keys()) })
    res.writeHead(400, { "Content-Type": "text/html" })
    res.end(HTML_ERROR(errorMsg))
    return
  }

  const pending = pendingAuths.get(state)!

  clearTimeout(pending.timeout)
  pendingAuths.delete(state)
  cleanupStateIndex(state)
  pending.resolve(code)

  res.writeHead(200, { "Content-Type": "text/html" })
  res.end(HTML_SUCCESS)
}

export async function ensureRunning(redirectUri?: string): Promise<void> {
  // Parse the redirect URI to get port and path (uses defaults if not provided)
  const { port, path } = parseRedirectUri(redirectUri)

  // If server is running on a different port/path, stop it first
  if (server && (currentPort !== port || currentPath !== path)) {
    log.info("stopping oauth callback server to reconfigure", { oldPort: currentPort, newPort: port })
    await stop()
  }

  if (server) return

  const running = await isPortInUse(port)
  if (running) {
    log.info("oauth callback server already running on another instance", { port })
    return
  }

  currentPort = port
  currentPath = path

  server = createServer(handleRequest)
  await new Promise<void>((resolve, reject) => {
    server!.listen(currentPort, () => {
      log.info("oauth callback server started", { port: currentPort, path: currentPath })
      resolve()
    })
    server!.on("error", reject)
  })
}

export function waitForCallback(oauthState: string, mcpName?: string): Promise<string> {
  if (mcpName) mcpNameToState.set(mcpName, oauthState)
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (pendingAuths.has(oauthState)) {
        pendingAuths.delete(oauthState)
        if (mcpName) mcpNameToState.delete(mcpName)
        reject(new Error("OAuth callback timeout - authorization took too long"))
      }
    }, CALLBACK_TIMEOUT_MS)

    pendingAuths.set(oauthState, { resolve, reject, timeout })
  })
}

export function cancelPending(mcpName: string): void {
  // Look up the oauthState for this mcpName via the reverse index
  const oauthState = mcpNameToState.get(mcpName)
  const key = oauthState ?? mcpName
  const pending = pendingAuths.get(key)
  if (pending) {
    clearTimeout(pending.timeout)
    pendingAuths.delete(key)
    mcpNameToState.delete(mcpName)
    pending.reject(new Error("Authorization cancelled"))
  }
}

export async function isPortInUse(port: number = OAUTH_CALLBACK_PORT): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(port, "127.0.0.1")
    socket.on("connect", () => {
      socket.destroy()
      resolve(true)
    })
    socket.on("error", () => {
      resolve(false)
    })
  })
}

export async function stop(): Promise<void> {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()))
    server = undefined
    log.info("oauth callback server stopped")
  }

  for (const [_name, pending] of pendingAuths) {
    clearTimeout(pending.timeout)
    pending.reject(new Error("OAuth callback server stopped"))
  }
  pendingAuths.clear()
  mcpNameToState.clear()
}

export function isRunning(): boolean {
  return server !== undefined
}

export * as McpOAuthCallback from "./oauth-callback"
