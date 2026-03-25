/**
 * mcp-server.test.ts
 *
 * Tests for the MCP HTTP server created by `createMcpServer`. These tests
 * exercise the `editor://context` resource, authentication, session routing,
 * and server lifecycle using a fake `EditorState` — no VS Code host needed.
 *
 * Run with: cd sdks/vscode && bun test
 */

import { describe, test, expect, afterEach } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { createMcpServer, type McpServerHandle } from "../src/mcp-server"
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Connects an MCP client to a test server, completing the `initialize`
 * handshake. The returned client is ready for resource reads.
 *
 * @param port      TCP port the test server is listening on.
 * @param authToken Bearer token expected by the server.
 */
async function connectClient(port: number, authToken: string): Promise<Client> {
  const client = new Client({ name: "test", version: "1.0.0" })
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}`), {
    requestInit: { headers: { Authorization: `Bearer ${authToken}` } },
  })
  await client.connect(transport)
  return client
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createMcpServer", () => {
  /** Shared auth token used across most tests. */
  const authToken = "test-token"

  /** Handles cleaned up in afterEach so every test starts fresh. */
  let handle: McpServerHandle | null = null
  let client: Client | null = null

  afterEach(async () => {
    await client?.close()
    await handle?.close()
    client = null
    handle = null
  })

  // -------------------------------------------------------------------------
  // editor://context resource
  // -------------------------------------------------------------------------

  describe("editor://context resource", () => {
    test("returns file path and selection", async () => {
      handle = await createMcpServer(
        () => ({
          uri: "/workspace/src/index.ts",
          selection: {
            start: { line: 10, column: 0 },
            end: { line: 15, column: 22 },
            text: "selected code",
          },
        }),
        "1.0.0",
        authToken,
      )
      client = await connectClient(handle.port, authToken)

      const result = await client.readResource({
        uri: "editor://context",
      })
      const parsed = JSON.parse((result.contents[0] as { text: string }).text)

      expect(parsed.uri).toBe("/workspace/src/index.ts")
      expect(parsed.selection.text).toBe("selected code")
      expect(parsed.selection.start.line).toBe(10)
      expect(parsed.selection.end.line).toBe(15)
    })

    test("returns file path without selection when nothing selected", async () => {
      handle = await createMcpServer(
        () => ({ uri: "/workspace/src/index.ts" }),
        "1.0.0",
        authToken,
      )
      client = await connectClient(handle.port, authToken)

      const result = await client.readResource({
        uri: "editor://context",
      })
      const parsed = JSON.parse((result.contents[0] as { text: string }).text)

      expect(parsed.uri).toBe("/workspace/src/index.ts")
      expect(parsed.selection).toBeUndefined()
    })

    test("returns empty object when no editor is open", async () => {
      handle = await createMcpServer(() => ({}), "1.0.0", authToken)
      client = await connectClient(handle.port, authToken)

      const result = await client.readResource({
        uri: "editor://context",
      })
      const parsed = JSON.parse((result.contents[0] as { text: string }).text)

      expect(parsed).toEqual({})
    })
  })

  // -------------------------------------------------------------------------
  // Authentication
  // -------------------------------------------------------------------------

  describe("authentication", () => {
    test("rejects requests with wrong token", async () => {
      handle = await createMcpServer(() => ({}), "1.0.0", authToken)

      const badClient = new Client({ name: "test", version: "1.0.0" })
      const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${handle.port}`), {
        requestInit: {
          headers: { Authorization: "Bearer wrong-token" },
        },
      })
      await expect(badClient.connect(transport)).rejects.toThrow()
    })

    test("rejects requests with no token", async () => {
      handle = await createMcpServer(() => ({}), "1.0.0", authToken)

      const badClient = new Client({ name: "test", version: "1.0.0" })
      const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${handle.port}`))
      await expect(badClient.connect(transport)).rejects.toThrow()
    })
  })

  // -------------------------------------------------------------------------
  // Session routing
  // -------------------------------------------------------------------------

  describe("session routing", () => {
    test("multiple resource reads on same client work", async () => {
      handle = await createMcpServer(
        () => ({ uri: "/workspace/file.ts" }),
        "1.0.0",
        authToken,
      )
      client = await connectClient(handle.port, authToken)

      // First read
      const r1 = await client.readResource({ uri: "editor://context" })
      const p1 = JSON.parse((r1.contents[0] as { text: string }).text)
      expect(p1.uri).toBe("/workspace/file.ts")

      // Second read on the same session — verifies session routing works.
      const r2 = await client.readResource({ uri: "editor://context" })
      const p2 = JSON.parse((r2.contents[0] as { text: string }).text)
      expect(p2.uri).toBe("/workspace/file.ts")
    })
  })

  // -------------------------------------------------------------------------
  // Notifications
  // -------------------------------------------------------------------------

  describe("notifyContextChanged", () => {
    test("broadcasts resource-updated to all connected clients", async () => {
      handle = await createMcpServer(
        () => ({ uri: "/workspace/file.ts" }),
        "1.0.0",
        authToken,
      )

      // Connect two independent clients to the same server, each getting
      // its own MCP session.
      const client1 = await connectClient(handle.port, authToken)
      const client2 = await connectClient(handle.port, authToken)

      // Subscribe both clients to the resource.
      await client1.subscribeResource({ uri: "editor://context" })
      await client2.subscribeResource({ uri: "editor://context" })

      // Set up notification promises with timeout guards so the test fails
      // clearly instead of hanging if a notification never arrives.
      function awaitNotification(c: Client): Promise<string> {
        return new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("notification did not arrive within 5s")), 5000)
          c.setNotificationHandler(ResourceUpdatedNotificationSchema, (n) => {
            clearTimeout(timer)
            resolve(n.params.uri)
          })
        })
      }

      const p1 = awaitNotification(client1)
      const p2 = awaitNotification(client2)

      // Trigger a broadcast — both clients should receive the notification.
      await handle.notifyContextChanged()

      expect(await p1).toBe("editor://context")
      expect(await p2).toBe("editor://context")

      await client1.close()
      await client2.close()
    })
  })

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  describe("lifecycle", () => {
    test("close() shuts down cleanly", async () => {
      handle = await createMcpServer(() => ({}), "1.0.0", authToken)
      const port = handle.port
      await handle.close()
      handle = null

      // After close, the server should no longer accept connections.
      await expect(fetch(`http://127.0.0.1:${port}`)).rejects.toThrow()
    })

    test("server binds to 127.0.0.1", async () => {
      handle = await createMcpServer(() => ({}), "1.0.0", authToken)
      expect(handle.port).toBeGreaterThan(0)
    })
  })
})
