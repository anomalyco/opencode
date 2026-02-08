/**
 * WebSocket proxy for PTY connections
 * UI connects to: ws://<claxedo>/w/:workspaceId/pty/:ptyId/connect?token=<jwt> or /pty/:ptyId/connect?directory=...&token=<jwt>
 * We forward to: wss://<sandboxPreview>/pty/:ptyId/connect?...
 */
import { WebSocket, WebSocketServer } from "ws"
import { type IncomingMessage } from "node:http"
import { type Duplex } from "node:stream"
import {
  resolveWorkspaceUpstream,
  resolveDirectoryUpstream,
  resolveOrganizationIdForWorkspace,
} from "../../services/sandbox-resolver.ts"
import { normalizeDirectory } from "../lib/paths.ts"
import { Config } from "../../config/index.ts"
import { verifyClerkJwt } from "../../services/clerk-jwt.ts"
import {
  withSpan,
  SpanKind,
  encodeTraceContextForWs,
  websocketConnectionsActive,
  websocketMessagesTotal,
  websocketConnectionDuration,
  ptyCreationDuration,
  startTimer,
} from "../../observability/index.ts"

const DEBUG_WS_PROXY = Config.OPENCODE_DEBUG_WS_PROXY

interface WebSocketAuthResult {
  ok: true
  userId: string
  organizationId: string
}

interface WebSocketAuthError {
  ok: false
  status: number
  error: string
}

/**
 * Authenticate WebSocket upgrade request with JWT verification.
 * Fails closed - if verification fails or ownership cannot be confirmed, access is denied.
 */
async function authenticateWebSocket(
  req: IncomingMessage,
  workspaceId: string,
  directory?: string,
): Promise<WebSocketAuthResult | WebSocketAuthError> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)

  // Extract token from query param
  const token = url.searchParams.get("token")
  if (!token) {
    return { ok: false, status: 401, error: "Missing token" }
  }

  // Verify JWT signature and parse claims
  const claims = await verifyClerkJwt(token)
  if (!claims) {
    return { ok: false, status: 401, error: "Invalid or expired token" }
  }

  // Require organization context
  if (!claims.organizationId) {
    return { ok: false, status: 403, error: "Organization context required" }
  }

  // For workspace connections, verify workspace ownership
  if (workspaceId) {
    try {
      const workspaceOrgId = await resolveOrganizationIdForWorkspace(workspaceId)
      // FAIL CLOSED: If we can't determine ownership, deny access
      if (!workspaceOrgId) {
        return { ok: false, status: 403, error: "Cannot verify workspace ownership" }
      }
      if (workspaceOrgId !== claims.organizationId) {
        return { ok: false, status: 403, error: "Workspace belongs to different organization" }
      }
    } catch (err) {
      // FAIL CLOSED: Any error in ownership check denies access
      return { ok: false, status: 500, error: "Failed to verify workspace ownership" }
    }
  }

  // For directory connections, resolve workspace and verify ownership
  if (directory) {
    try {
      const resolved = await resolveDirectoryUpstream(normalizeDirectory(directory))
      if (!resolved?.workspaceId) {
        return { ok: false, status: 404, error: "Directory not found" }
      }

      const workspaceOrgId = await resolveOrganizationIdForWorkspace(resolved.workspaceId)
      // FAIL CLOSED: If we can't determine ownership, deny access
      if (!workspaceOrgId) {
        return { ok: false, status: 403, error: "Cannot verify directory ownership" }
      }
      if (workspaceOrgId !== claims.organizationId) {
        return { ok: false, status: 403, error: "Directory belongs to different organization" }
      }
    } catch (err) {
      // FAIL CLOSED: Any error in ownership check denies access
      return { ok: false, status: 500, error: "Failed to verify directory ownership" }
    }
  }

  // Must have either workspaceId or directory for ownership verification
  if (!workspaceId && !directory) {
    return { ok: false, status: 400, error: "Missing workspace or directory context" }
  }

  return { ok: true, userId: claims.userId, organizationId: claims.organizationId }
}

/**
 * Convert data to string for WebSocket transmission to client.
 * Ensures binary data is properly decoded as UTF-8.
 */
function toText(data: unknown): string {
  if (typeof data === "string") return data
  if (Buffer.isBuffer(data)) return data.toString("utf-8")
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf-8")
  if (data instanceof Uint8Array) return Buffer.from(data).toString("utf-8")
  if (Array.isArray(data)) return Buffer.concat(data as Buffer[]).toString("utf-8")
  return String(data)
}

/**
 * Create WebSocket server for PTY connections
 */
export function createPtyWebSocketServer(): WebSocketServer {
  return new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
  })
}

/**
 * Handle WebSocket upgrade for PTY connections
 */
export async function handlePtyUpgrade(
  wss: WebSocketServer,
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)

  // Match /w/:workspaceId/pty/:ptyId/connect or /pty/:ptyId/connect
  const workspaceMatch = url.pathname.match(/^\/w\/([^/]+)\/pty\/([^/]+)\/connect\/?$/)
  const directoryMatch = url.pathname.match(/^\/pty\/([^/]+)\/connect\/?$/)

  if (!workspaceMatch && !directoryMatch) {
    return false // Not a PTY WebSocket request
  }

  const kind = workspaceMatch ? "workspace" : "directory"
  const id = workspaceMatch ? workspaceMatch[1] : ""
  const ptyId = workspaceMatch ? workspaceMatch[2] : directoryMatch ? directoryMatch[1] : ""

  // ═══════════════════════════════════════════════════════════════
  // AUTHENTICATION WITH VERIFICATION
  // ═══════════════════════════════════════════════════════════════
  const auth = await authenticateWebSocket(
    req,
    kind === "workspace" ? id : "",
    kind === "directory" ? url.searchParams.get("directory") || "" : undefined,
  )
  if (!auth.ok) {
    if (DEBUG_WS_PROXY) {
      console.error("[ws-proxy] auth failed", { kind, id, status: auth.status, error: auth.error })
    }
    socket.write(`HTTP/1.1 ${auth.status} ${auth.error}\r\n\r\n`)
    socket.destroy()
    return true
  }

  wss.handleUpgrade(req, socket, head, async (clientWs) => {
    const connectionTimer = startTimer()
    websocketConnectionsActive.inc({ type: "pty" })

    try {
      // Resolve upstream sandbox URL with timing
      const resolveTimer = startTimer()
      const resolved =
        kind === "workspace"
          ? await resolveWorkspaceUpstream(id)
          : await resolveDirectoryUpstream(normalizeDirectory(url.searchParams.get("directory") || ""))
      const resolveDuration = resolveTimer()

      if (!resolved?.sandboxUrl) {
        clientWs.close(1011, "No sandbox URL")
        ptyCreationDuration.observe({ workspace_id: id || "unknown", status: "error" }, resolveDuration)
        websocketConnectionsActive.dec({ type: "pty" })
        return
      }

      // Build upstream WebSocket URL
      const upstream = new URL(resolved.sandboxUrl)
      upstream.protocol = upstream.protocol === "https:" ? "wss:" : "ws:"
      upstream.pathname = `/pty/${encodeURIComponent(ptyId)}/connect`
      // Copy query params except token (don't forward auth token to sandbox)
      for (const [key, value] of url.searchParams) {
        if (key !== "token") {
          upstream.searchParams.set(key, value)
        }
      }

      // Add trace context for distributed tracing
      const traceCtx = encodeTraceContextForWs()
      if (traceCtx) {
        upstream.searchParams.set("trace", traceCtx)
      }

      // Extract WebSocket subprotocols
      const protocolsHeader = req.headers["sec-websocket-protocol"]
      const protocols =
        typeof protocolsHeader === "string"
          ? protocolsHeader
              .split(",")
              .map((p) => p.trim())
              .filter(Boolean)
          : undefined

      // Connect to upstream
      const upstreamWs = new WebSocket(upstream.toString(), protocols, {
        headers: { origin: upstream.origin } as Record<string, string>,
        perMessageDeflate: false,
      })

      const state = { open: false }
      const queue: string[] = []

      const flush = () => {
        if (!state.open) return
        if (queue.length === 0) return
        for (const item of queue) upstreamWs.send(item)
        queue.length = 0
      }

      // Bridge client to upstream
      upstreamWs.on("open", () => {
        state.open = true
        flush()
        // Record successful PTY connection
        ptyCreationDuration.observe({ workspace_id: id || "unknown", status: "success" }, connectionTimer())
      })

      upstreamWs.on("message", (data) => {
        if (clientWs.readyState !== WebSocket.OPEN) return
        // Always send as text to client - decode binary data as UTF-8
        const text = toText(data)
        clientWs.send(text)
        websocketMessagesTotal.inc({ type: "pty", direction: "out" })
      })

      upstreamWs.on("close", (code) => {
        if (clientWs.readyState !== WebSocket.OPEN) return
        clientWs.close(code)
        websocketConnectionsActive.dec({ type: "pty" })
        websocketConnectionDuration.observe({ type: "pty", close_reason: "upstream_close" }, connectionTimer())
      })

      upstreamWs.on("error", () => {
        if (clientWs.readyState !== WebSocket.OPEN) return
        clientWs.close(1011, "Upstream error")
        websocketConnectionsActive.dec({ type: "pty" })
        websocketConnectionDuration.observe({ type: "pty", close_reason: "upstream_error" }, connectionTimer())
      })

      clientWs.on("message", (data) => {
        // Always send as text to upstream - decode binary data as UTF-8
        // This prevents upstream from receiving ArrayBuffer which it handles poorly
        const text = toText(data)
        websocketMessagesTotal.inc({ type: "pty", direction: "in" })
        if (!state.open) {
          queue.push(text)
          return
        }
        upstreamWs.send(text)
      })

      clientWs.on("close", () => {
        try {
          upstreamWs.close()
        } catch {}
        websocketConnectionsActive.dec({ type: "pty" })
        websocketConnectionDuration.observe({ type: "pty", close_reason: "client_close" }, connectionTimer())
      })

      clientWs.on("error", () => {
        try {
          upstreamWs.close()
        } catch {}
        websocketConnectionsActive.dec({ type: "pty" })
        websocketConnectionDuration.observe({ type: "pty", close_reason: "client_error" }, connectionTimer())
      })
    } catch (err: unknown) {
      if (DEBUG_WS_PROXY) {
        const message = err instanceof Error ? err.message : String(err)
        console.error("[ws-proxy] setup error", {
          kind,
          id,
          ptyId,
          error: message,
        })
      }
      clientWs.close(1011, "Proxy error")
      websocketConnectionsActive.dec({ type: "pty" })
      websocketConnectionDuration.observe({ type: "pty", close_reason: "setup_error" }, connectionTimer())
    }
  })

  return true
}
