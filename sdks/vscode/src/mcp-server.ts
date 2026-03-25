/**
 * mcp-server.ts
 *
 * Implements a lightweight MCP (Model Context Protocol) HTTP server that runs
 * inside the VS Code extension process. It exposes an `editor://context`
 * resource that lets opencode query the editor's active file and selection
 * without having to go through the VS Code extension host command API — the
 * CLI can just make a plain HTTP request instead.
 *
 * Clients can subscribe to resource-update notifications so they are informed
 * whenever the editor context changes (e.g. active file switch, selection
 * change). The extension calls `notifyContextChanged()` to broadcast these
 * updates to all connected sessions.
 *
 * The server binds to 127.0.0.1 on an OS-assigned ephemeral port (port 0) so
 * it never conflicts with other services. Bearer-token auth guards every
 * request so that only the opencode process that spawned the extension can
 * talk to it.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { SubscribeRequestSchema, UnsubscribeRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import http from "http"
import { randomUUID } from "crypto"

// ---------------------------------------------------------------------------
// EditorContext — the shape of the `editor://context` resource payload
// ---------------------------------------------------------------------------

/**
 * The current state of the editor, returned as a JSON payload by the
 * `editor://context` MCP resource. This type definition must be kept in sync
 * with `EditorContext` defined in `packages/opencode/src/ide/index.ts`.
 */
export interface EditorContext {
  /**
   * URI of the focused editor document, if any (e.g. `file:///path/to/file.ts`,
   * `git:///path?ref=HEAD`, `output:channel-name`). All URI schemes are
   * included so that non-file contexts like diff views and output panels are
   * visible to the consumer.
   */
  uri?: string

  /**
   * The highlighted text selection, if any. Absent when there is no active
   * editor or the selection is empty (i.e. just a cursor with no highlighted
   * text).
   */
  selection?: {
    /** Line and column position of the first selected character (inclusive). */
    start: { line: number; column: number }
    /** Line and column position after the last selected character (exclusive). */
    end: { line: number; column: number }
    /** The selected text content. */
    text: string
  }
}

// ---------------------------------------------------------------------------
// EditorState — abstraction over the IDE for testing
// ---------------------------------------------------------------------------

/**
 * Returns the current editor context. Having this as a replaceable function
 * lets tests inject a fake without spinning up a real VS Code host.
 */
export type EditorState = () => EditorContext

// ---------------------------------------------------------------------------
// McpServerHandle — port, notification broadcast, and graceful shutdown
// ---------------------------------------------------------------------------

/**
 * Handle returned by `createMcpServer`. Callers use `port` to tell the
 * opencode CLI where to connect, `notifyContextChanged()` to broadcast
 * resource-update notifications, and `close()` when the extension deactivates
 * so the HTTP server is shut down cleanly.
 */
export interface McpServerHandle {
  /** The actual TCP port the server is listening on (OS-assigned). */
  port: number

  /**
   * Notify all connected MCP clients that the `editor://context` resource has
   * changed. Clients that have subscribed to resource updates will receive a
   * `notifications/resources/updated` message. Errors on individual sessions
   * are silently swallowed so one broken connection doesn't affect others.
   */
  notifyContextChanged(): Promise<void>

  /** Shuts down the HTTP server and all active MCP sessions. */
  close(): Promise<void>
}

// ---------------------------------------------------------------------------
// createMcpServer
// ---------------------------------------------------------------------------

/**
 * Creates and starts an MCP HTTP server bound to 127.0.0.1 on a random
 * OS-assigned port.
 *
 * Protocol summary
 * ----------------
 * - Every request must carry `Authorization: Bearer <authToken>` or it gets
 *   a 401 response.
 * - POST /  → creates a new MCP session (StreamableHTTPServerTransport).
 * - GET  /  with `mcp-session-id` header → streams events for an existing
 *   session (SSE).
 * - DELETE / with `mcp-session-id` header → closes an existing session.
 *
 * Each session is independent; sessions are stored in a simple in-memory map
 * keyed by the session ID that the transport generates.
 *
 * @param editorState  Source of VS Code editor information.
 * @param version      VS Code extension version, reported in MCP server info
 *                     during initialization (informational, used for debugging).
 * @param authToken    Secret token that clients must supply as a Bearer token.
 */
export async function createMcpServer(
  editorState: EditorState,
  version: string,
  authToken: string,
): Promise<McpServerHandle> {
  type Session = {
    /** Handles HTTP request/response routing and SSE streaming for one connected client. */
    transport: StreamableHTTPServerTransport

    /**
     * Registers the `editor://context` resource and sends notifications over
     * the transport. Each session needs its own McpServer because the SDK only
     * allows one transport per McpServer instance.
     */
    server: McpServer
  }

  // All active sessions, keyed by the session ID that the transport generates.
  // Entries are added on POST (initialization) and removed when the transport closes.
  const sessions = new Map<string, Session>()

  // ---------------------------------------------------------------------------
  // MCP server + resource registration
  // ---------------------------------------------------------------------------

  /**
   * Creates a fresh McpServer instance and registers the `editor://context`
   * resource. We create one McpServer per session because McpServer is
   * stateful (it owns the transport connection lifecycle). Re-using a single
   * McpServer across sessions is not supported by the SDK.
   */
  function createSessionServer(): McpServer {
    const mcp = new McpServer(
      { name: "opencode-vscode", version },
      { capabilities: { resources: { subscribe: true } } },
    )

    // The MCP SDK (v1.25.2) does not automatically register handlers for
    // resources/subscribe and resources/unsubscribe, even when the server
    // declares `subscribe: true` in its capabilities. Without these, clients
    // get a MethodNotFound error when they try to subscribe.
    //
    // A more fully-featured MCP server would track which resources each client
    // subscribes to and only notify those clients. Here we no-op because
    // there's only one resource (`editor://context`) and we broadcast to all
    // sessions anyway.
    //
    // Remove/update these if a future SDK version handles subscribe natively,
    // or if we add more resources.
    mcp.server.setRequestHandler(SubscribeRequestSchema, async () => ({}))
    mcp.server.setRequestHandler(UnsubscribeRequestSchema, async () => ({}))

    /**
     * `editor://context` — the sole resource exposed by this server.
     *
     * Returns the current editor context as JSON (active document URI and
     * text selection). Calls the `editorState` function each time so the
     * result is always up-to-date.
     */
    mcp.registerResource(
      "editorContext",
      "editor://context",
      {
        description: "Current editor state: active file path and text selection",
        mimeType: "application/json",
      },
      async (resourceUri) => ({
        contents: [
          {
            uri: resourceUri.href,
            mimeType: "application/json",
            text: JSON.stringify(editorState()),
          },
        ],
      }),
    )

    return mcp
  }

  // ---------------------------------------------------------------------------
  // HTTP server
  // ---------------------------------------------------------------------------

  const httpServer = http.createServer(async (req: http.IncomingMessage, res: http.ServerResponse) => {
    // ------------------------------------------------------------------
    // Auth check. Binding to 127.0.0.1 means the port is not reachable
    // from other machines, but any process running locally (e.g. under a
    // different user account) can connect. A shared secret (Bearer token)
    // ensures that only the opencode CLI that discovered the lock file can
    // talk to this server.
    // ------------------------------------------------------------------
    const authHeader = req.headers["authorization"] ?? ""
    const expectedHeader = `Bearer ${authToken}`
    if (authHeader !== expectedHeader) {
      res.writeHead(401, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: "Unauthorized" }))
      return
    }

    const sessionId = req.headers["mcp-session-id"] as string | undefined
    const method = req.method?.toUpperCase()

    if (method === "POST") {
      // ------------------------------------------------------------------
      // POST — either continue an existing session or start a new one. The
      // first POST has no session ID and triggers session creation. Subsequent
      // POSTs include an `mcp-session-id` header and must be routed to the
      // existing transport. Today the only follow-up POST is `initialized` (the
      // client reads resources over GET/SSE), but the spec allows arbitrary
      // RPCs over POST, so we handle routing for correctness.
      // ------------------------------------------------------------------
      if (sessionId && sessions.has(sessionId)) {
        await sessions.get(sessionId)!.transport.handleRequest(req, res)
        return
      }

      const mcp = createSessionServer()

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, { transport, server: mcp })
        },
      })

      // Clean up when the transport closes. If `notifyContextChanged()` races
      // with this cleanup, the deleted session may still receive a notification
      // attempt — the .catch(() => {}) in `notifyContextChanged` handles that
      // safely.
      transport.onclose = () => {
        if (transport.sessionId) {
          sessions.delete(transport.sessionId)
        }
      }

      await mcp.connect(transport)
      await transport.handleRequest(req, res)
    } else if ((method === "GET" || method === "DELETE") && sessionId) {
      // ------------------------------------------------------------------
      // GET / DELETE with a session ID — route to the existing session.
      // ------------------------------------------------------------------
      const session = sessions.get(sessionId)
      if (!session) {
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Unknown session ID" }))
        return
      }
      await session.transport.handleRequest(req, res)
    } else {
      res.writeHead(400, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: "Bad request" }))
    }
  })

  // Bind to loopback only — this server should never be reachable from outside
  // the local machine.
  await new Promise<void>((resolve, reject) => {
    httpServer.listen(0, "127.0.0.1", () => resolve())
    httpServer.once("error", reject)
  })

  // address() returns null if not listening, a string if bound to a Unix
  // socket, or AddressInfo for TCP. We always bind to TCP above.
  const address = httpServer.address()
  if (!address || typeof address === "string") {
    throw new Error("Unexpected server address format")
  }
  const port = address.port

  // ---------------------------------------------------------------------------
  // Construct and return the handle
  // ---------------------------------------------------------------------------
  return {
    port,
    async notifyContextChanged() {
      // Broadcast a resource-update notification to every active session.
      // Errors are swallowed per-session so one broken connection doesn't
      // prevent the rest from being notified.
      for (const { server } of sessions.values()) {
        server.server.sendResourceUpdated({ uri: "editor://context" }).catch(() => {})
      }
    },
    async close() {
      // Close all active sessions first so clients get a clean disconnect.
      await Promise.all([...sessions.values()].map((s) => s.transport.close()))
      sessions.clear()

      // Then shut down the HTTP server.
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err: Error | undefined) => (err ? reject(err) : resolve()))
      })
    },
  }
}
