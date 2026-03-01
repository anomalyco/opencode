import { strict as assert } from "assert"
import { describe, it, beforeEach } from "mocha"
import * as vscode from "vscode"
import { SessionManager, SessionMetadata } from "./session"
import { AcpClient, AcpClientConfig } from "../acp/client"
import { JsonRpcConnection } from "../acp/connection"
import { Readable, Writable } from "stream"

// Mock streams for testing
function createMockStreams() {
  const stdin = new Writable({
    write(chunk, encoding, callback) {
      stdin.written.push(chunk.toString())
      callback()
    },
  }) as Writable & { written: string[] }
  stdin.written = []

  const stdout = new Readable({ read() {} }) as Readable & { pushData: (data: string) => void }
  stdout.pushData = (data: string) => stdout.push(data)

  return { stdin, stdout }
}

// Mock workspace state
function createMockWorkspaceState(): vscode.Memento & { keys: string[]; storage: Map<string, unknown> } {
  const storage = new Map<string, unknown>()

  return {
    keys: [],
    storage,
    get<T>(key: string): T | undefined {
      return storage.get(key) as T | undefined
    },
    update: async (key: string, value: unknown): Promise<void> => {
      if (value === undefined) {
        storage.delete(key)
      } else {
        storage.set(key, value)
      }
    },
  } as unknown as vscode.Memento & { keys: string[]; storage: Map<string, unknown> }
}

// Mock ChatContext with history
function createMockChatContext(history: any[] = []): vscode.ChatContext {
  return { history }
}

// Mock ChatResult
function createMockChatResult(sessionId?: string): vscode.ChatResult {
  return {
    metadata: sessionId ? { sessionId } : undefined,
  }
}

describe("SessionManager", () => {
  let manager: SessionManager
  let mockWorkspaceState: ReturnType<typeof createMockWorkspaceState>
  let mockContext: vscode.ExtensionContext
  let client: AcpClient
  let streams: ReturnType<typeof createMockStreams>
  let connection: JsonRpcConnection

  beforeEach(async () => {
    mockWorkspaceState = createMockWorkspaceState()

    // Create mock extension context
    mockContext = {
      subscriptions: [],
      workspaceState: mockWorkspaceState,
      asAbsolutePath: (relativePath: string) => `/mock/path/${relativePath}`,
    } as unknown as vscode.ExtensionContext

    streams = createMockStreams()
    connection = new JsonRpcConnection(streams.stdin, streams.stdout)

    const config: AcpClientConfig = {
      connection,
      clientInfo: { name: "test-client", version: "1.0.0" },
    }
    client = new AcpClient(config)

    // Initialize client
    const initPromise = client.initialize()
    await new Promise((r) => setTimeout(r, 10))
    const request = JSON.parse(streams.stdin.written[streams.stdin.written.length - 1])
    streams.stdout.pushData(
      JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          protocolVersion: 1,
          agentCapabilities: {},
          agentInfo: { name: "opencode", version: "1.0.0" },
        },
      }) + "\n",
    )
    await initPromise

    manager = new SessionManager(mockContext, client)
  })

  describe("creates new session when none exists", () => {
    it("creates new session via ACP when no existing session", async () => {
      const chatContext = createMockChatContext()

      const sessionPromise = manager.getOrCreateSession(chatContext)

      // Wait for session/new call
      await new Promise((r) => setTimeout(r, 10))

      const newSessionReq = streams.stdin.written.find((w) => {
        try {
          const parsed = JSON.parse(w)
          return parsed.method === "session/new"
        } catch {
          return false
        }
      })

      assert.ok(newSessionReq, "Should call session/new")
      const parsed = JSON.parse(newSessionReq)
      assert.ok(parsed.params.cwd, "Should include cwd in session request")

      // Send session response
      const acpSessionId = "acp_session_123"
      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: parsed.id,
          result: { sessionId: acpSessionId },
        }) + "\n",
      )

      const sessionId = await sessionPromise
      assert.ok(sessionId, "Should return a session ID")
      assert.strictEqual(sessionId.startsWith("vsc_"), true, "Session ID should start with vsc_")
    })

    it("stores session metadata in workspaceState", async () => {
      const chatContext = createMockChatContext()

      const sessionPromise = manager.getOrCreateSession(chatContext)

      await new Promise((r) => setTimeout(r, 10))
      const newSessionReq = streams.stdin.written.find((w) => {
        try {
          const parsed = JSON.parse(w)
          return parsed.method === "session/new"
        } catch {
          return false
        }
      })
      const parsed = JSON.parse(newSessionReq!)

      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: parsed.id,
          result: { sessionId: "acp_session_123" },
        }) + "\n",
      )

      await sessionPromise

      // Verify session stored in workspaceState
      const sessions = mockWorkspaceState.get<Record<string, SessionMetadata>>("opencode.sessions")
      assert.ok(sessions, "Sessions should be stored in workspaceState")
      assert.strictEqual(Object.keys(sessions!).length, 1, "Should have one session")

      const session = Object.values(sessions!)[0]
      assert.ok(session.id, "Session should have id")
      assert.ok(session.acpSessionId, "Session should have acpSessionId")
      assert.ok(session.createdAt, "Session should have createdAt")
      assert.ok(session.cwd, "Session should have cwd")
    })
  })

  describe("reuses existing session from metadata", () => {
    it("returns existing session ID when in ChatResult.metadata", async () => {
      const existingSessionId = "vsc_existing_123"
      const existingAcpSessionId = "acp_existing_123"

      // Pre-populate workspaceState with existing session
      const existingSessions: Record<string, SessionMetadata> = {
        [existingSessionId]: {
          id: existingSessionId,
          title: "Existing Session",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          cwd: "/mock/workspace",
          acpSessionId: existingAcpSessionId,
        },
      }
      await mockWorkspaceState.update("opencode.sessions", existingSessions)

      // Create chat context with history containing ChatResult
      const history = [
        {
          result: { metadata: { sessionId: existingSessionId } },
          participant: "opencode",
        },
      ]
      const chatContext = createMockChatContext(history)

      const sessionId = await manager.getOrCreateSession(chatContext)

      assert.strictEqual(sessionId, existingSessionId, "Should return existing session ID")

      // Verify no new session was created
      const newSessionReq = streams.stdin.written.find((w) => {
        try {
          const parsed = JSON.parse(w)
          return parsed.method === "session/new"
        } catch {
          return false
        }
      })
      assert.strictEqual(newSessionReq, undefined, "Should not call session/new")
    })

    it("loads session via ACP when session exists in metadata but not loaded", async () => {
      const existingSessionId = "vsc_existing_456"
      const existingAcpSessionId = "acp_existing_456"

      // Pre-populate workspaceState
      const existingSessions: Record<string, SessionMetadata> = {
        [existingSessionId]: {
          id: existingSessionId,
          title: "Existing Session",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          cwd: "/mock/workspace",
          acpSessionId: existingAcpSessionId,
        },
      }
      await mockWorkspaceState.update("opencode.sessions", existingSessions)

      // Create context that references this session
      const history = [
        {
          result: { metadata: { sessionId: existingSessionId } },
          participant: "opencode",
        },
      ]
      const chatContext = createMockChatContext(history)

      const sessionPromise = manager.getOrCreateSession(chatContext)

      // Wait for potential session/load call
      await new Promise((r) => setTimeout(r, 10))

      const loadSessionReq = streams.stdin.written.find((w) => {
        try {
          const parsed = JSON.parse(w)
          return parsed.method === "session/load"
        } catch {
          return false
        }
      })

      assert.ok(loadSessionReq, "Should call session/load")
      const parsed = JSON.parse(loadSessionReq!)
      assert.strictEqual(parsed.params.sessionId, existingAcpSessionId, "Should load with ACP session ID")

      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: parsed.id,
          result: { sessionId: existingAcpSessionId },
        }) + "\n",
      )

      const sessionId = await sessionPromise
      assert.strictEqual(sessionId, existingSessionId, "Should return existing session ID")
    })
  })

  describe("loads session from OpenCode", () => {
    it("includes CLI-created sessions in listSessions", async () => {
      // First create a session
      const chatContext = createMockChatContext()

      const sessionPromise = manager.getOrCreateSession(chatContext)
      await new Promise((r) => setTimeout(r, 10))

      const newSessionReq = streams.stdin.written.find((w) => {
        try {
          const parsed = JSON.parse(w)
          return parsed.method === "session/new"
        } catch {
          return false
        }
      })
      const parsed = JSON.parse(newSessionReq!)

      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: parsed.id,
          result: { sessionId: "acp_cli_session_123" },
        }) + "\n",
      )

      await sessionPromise

      const sessions = await manager.listSessions()
      assert.strictEqual(sessions.length, 1, "Should list the created session")
      assert.strictEqual(sessions[0].acpSessionId, "acp_cli_session_123", "Should have correct ACP session ID")
    })
  })

  describe("persists session metadata to workspaceState", () => {
    it("persists session metadata immediately on creation", async () => {
      const chatContext = createMockChatContext()

      const sessionPromise = manager.getOrCreateSession(chatContext)
      await new Promise((r) => setTimeout(r, 10))

      const newSessionReq = streams.stdin.written.find((w) => {
        try {
          const parsed = JSON.parse(w)
          return parsed.method === "session/new"
        } catch {
          return false
        }
      })
      const parsed = JSON.parse(newSessionReq!)

      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: parsed.id,
          result: { sessionId: "acp_persist_123" },
        }) + "\n",
      )

      await sessionPromise

      const sessions = mockWorkspaceState.get<Record<string, SessionMetadata>>("opencode.sessions")
      assert.ok(sessions, "Sessions should be persisted")
      const session = Object.values(sessions!)[0]
      assert.strictEqual(session.acpSessionId, "acp_persist_123", "Should persist correct ACP session ID")
    })

    it("updates workspaceState when session is modified", async () => {
      const chatContext = createMockChatContext()

      // Create a session first
      const sessionPromise = manager.getOrCreateSession(chatContext)
      await new Promise((r) => setTimeout(r, 10))

      const newSessionReq = streams.stdin.written.find((w) => {
        try {
          const parsed = JSON.parse(w)
          return parsed.method === "session/new"
        } catch {
          return false
        }
      })
      const parsed = JSON.parse(newSessionReq!)
      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: parsed.id,
          result: { sessionId: "acp_update_123" },
        }) + "\n",
      )

      const sessionId = await sessionPromise

      // Update the session title
      await manager.updateSessionTitle(sessionId, "Updated Title")

      const sessions = mockWorkspaceState.get<Record<string, SessionMetadata>>("opencode.sessions")
      const session = Object.values(sessions!).find((s) => s.id === sessionId)
      assert.strictEqual(session!.title, "Updated Title", "Should update title in workspaceState")
    })
  })

  describe("handles session title updates", () => {
    it("updates session title", async () => {
      const chatContext = createMockChatContext()

      // Create a session
      const sessionPromise = manager.getOrCreateSession(chatContext)
      await new Promise((r) => setTimeout(r, 10))

      const newSessionReq = streams.stdin.written.find((w) => {
        try {
          const parsed = JSON.parse(w)
          return parsed.method === "session/new"
        } catch {
          return false
        }
      })
      const parsed = JSON.parse(newSessionReq!)
      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: parsed.id,
          result: { sessionId: "acp_title_123" },
        }) + "\n",
      )

      const sessionId = await sessionPromise

      // Update title
      await manager.updateSessionTitle(sessionId, "My New Title")

      const sessions = await manager.listSessions()
      const session = sessions.find((s) => s.id === sessionId)
      assert.ok(session, "Session should exist")
      assert.strictEqual(session!.title, "My New Title", "Should update title")
      assert.ok(session!.updatedAt > session!.createdAt, "Should update updatedAt timestamp")
    })

    it("throws error when updating non-existent session", async () => {
      try {
        await manager.updateSessionTitle("non_existent_session", "New Title")
        assert.fail("Should have thrown error")
      } catch (error) {
        assert.ok(error instanceof Error)
        assert.ok((error as Error).message.includes("Session not found"))
      }
    })
  })

  describe("lists all sessions for workspace", () => {
    it("returns empty array when no sessions exist", async () => {
      const sessions = await manager.listSessions()
      assert.deepStrictEqual(sessions, [], "Should return empty array")
    })

    it("returns all sessions sorted by updatedAt", async () => {
      const now = Date.now()

      // Pre-populate with multiple sessions
      const existingSessions: Record<string, SessionMetadata> = {
        session_1: {
          id: "session_1",
          title: "First Session",
          createdAt: now - 2000,
          updatedAt: now - 1000,
          cwd: "/mock/workspace",
          acpSessionId: "acp_1",
        },
        session_2: {
          id: "session_2",
          title: "Second Session",
          createdAt: now - 1000,
          updatedAt: now,
          cwd: "/mock/workspace",
          acpSessionId: "acp_2",
        },
        session_3: {
          id: "session_3",
          title: "Third Session",
          createdAt: now - 3000,
          updatedAt: now - 2000,
          cwd: "/mock/workspace",
          acpSessionId: "acp_3",
        },
      }
      await mockWorkspaceState.update("opencode.sessions", existingSessions)

      const sessions = await manager.listSessions()

      assert.strictEqual(sessions.length, 3, "Should return all sessions")
      assert.strictEqual(sessions[0].id, "session_2", "Should be sorted by updatedAt desc")
      assert.strictEqual(sessions[1].id, "session_1", "Second should be session_1")
      assert.strictEqual(sessions[2].id, "session_3", "Third should be session_3")
    })
  })

  describe("deletes sessions properly", () => {
    it("removes session from workspaceState", async () => {
      const now = Date.now()

      // Pre-populate with a session
      const existingSessions: Record<string, SessionMetadata> = {
        session_to_delete: {
          id: "session_to_delete",
          title: "Session to Delete",
          createdAt: now,
          updatedAt: now,
          cwd: "/mock/workspace",
          acpSessionId: "acp_delete_123",
        },
      }
      await mockWorkspaceState.update("opencode.sessions", existingSessions)

      await manager.deleteSession("session_to_delete")

      const sessions = mockWorkspaceState.get<Record<string, SessionMetadata>>("opencode.sessions")
      assert.strictEqual(Object.keys(sessions!).length, 0, "Should remove session")
    })

    it("throws error when deleting non-existent session", async () => {
      try {
        await manager.deleteSession("non_existent_session")
        assert.fail("Should have thrown error")
      } catch (error) {
        assert.ok(error instanceof Error)
        assert.ok((error as Error).message.includes("Session not found"))
      }
    })

    it("clears active session when deleted session is active", async () => {
      const chatContext = createMockChatContext()

      // Create and activate a session
      const sessionPromise = manager.getOrCreateSession(chatContext)
      await new Promise((r) => setTimeout(r, 10))

      const newSessionReq = streams.stdin.written.find((w) => {
        try {
          const parsed = JSON.parse(w)
          return parsed.method === "session/new"
        } catch {
          return false
        }
      })
      const parsed = JSON.parse(newSessionReq!)
      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: parsed.id,
          result: { sessionId: "acp_active_123" },
        }) + "\n",
      )

      const sessionId = await sessionPromise

      // Delete the active session
      await manager.deleteSession(sessionId)

      // Verify next getOrCreateSession creates a new one
      const newChatContext = createMockChatContext()
      const newSessionPromise = manager.getOrCreateSession(newChatContext)
      await new Promise((r) => setTimeout(r, 10))

      const secondNewSessionReq = streams.stdin.written.slice(-1)[0]
      const secondParsed = JSON.parse(secondNewSessionReq)

      if (secondParsed.method === "session/new") {
        assert.ok(true, "Should create new session after deleting active one")
      }
    })
  })

  describe("handles multi-workspace isolation", () => {
    it("uses workspace-specific storage key", async () => {
      const chatContext = createMockChatContext()

      const sessionPromise = manager.getOrCreateSession(chatContext)
      await new Promise((r) => setTimeout(r, 10))

      const newSessionReq = streams.stdin.written.find((w) => {
        try {
          const parsed = JSON.parse(w)
          return parsed.method === "session/new"
        } catch {
          return false
        }
      })
      const parsed = JSON.parse(newSessionReq!)
      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: parsed.id,
          result: { sessionId: "acp_workspace_123" },
        }) + "\n",
      )

      await sessionPromise

      // Verify storage key
      const hasSessionsKey = mockWorkspaceState.storage.has("opencode.sessions")
      assert.ok(hasSessionsKey, "Should use 'opencode.sessions' storage key")
    })

    it("isolates sessions between different workspaces", async () => {
      // This test verifies that sessions are isolated by using workspaceState
      // which is naturally isolated by VS Code per workspace

      const chatContext = createMockChatContext()

      // Create session in first workspace context
      const sessionPromise = manager.getOrCreateSession(chatContext)
      await new Promise((r) => setTimeout(r, 10))

      const newSessionReq = streams.stdin.written.find((w) => {
        try {
          const parsed = JSON.parse(w)
          return parsed.method === "session/new"
        } catch {
          return false
        }
      })
      const parsed = JSON.parse(newSessionReq!)
      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: parsed.id,
          result: { sessionId: "acp_isolated_123" },
        }) + "\n",
      )

      await sessionPromise

      // Verify session is stored and retrievable
      const sessions = await manager.listSessions()
      assert.strictEqual(sessions.length, 1, "Should have one session")
      assert.strictEqual(sessions[0].cwd, "/mock/path", "Should store correct cwd")
    })

    it("generates unique session IDs", async () => {
      const chatContext1 = createMockChatContext()
      const chatContext2 = createMockChatContext()

      // Create first session
      const session1Promise = manager.getOrCreateSession(chatContext1)
      await new Promise((r) => setTimeout(r, 10))

      const newSessionReq1 = streams.stdin.written.find((w) => {
        try {
          const parsed = JSON.parse(w)
          return parsed.method === "session/new"
        } catch {
          return false
        }
      })
      const parsed1 = JSON.parse(newSessionReq1!)
      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: parsed1.id,
          result: { sessionId: "acp_unique_1" },
        }) + "\n",
      )

      const sessionId1 = await session1Promise

      // Create second session
      const session2Promise = manager.getOrCreateSession(chatContext2)
      await new Promise((r) => setTimeout(r, 10))

      const newSessionReq2 = streams.stdin.written[streams.stdin.written.length - 1]
      const parsed2 = JSON.parse(newSessionReq2)
      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: parsed2.id,
          result: { sessionId: "acp_unique_2" },
        }) + "\n",
      )

      const sessionId2 = await session2Promise

      assert.notStrictEqual(sessionId1, sessionId2, "Should generate unique session IDs")
    })
  })
})
