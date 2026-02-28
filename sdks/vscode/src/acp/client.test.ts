import { strict as assert } from "assert"
import { describe, it, beforeEach, afterEach } from "mocha"
import { EventEmitter } from "events"
import { Readable, Writable } from "stream"
import {
  AcpClient,
  AcpClientConfig,
  AcpClientState,
  AcpError,
  AcpErrorCode,
  InitializeRequest,
  InitializeResponse,
  NewSessionRequest,
  NewSessionResponse,
  LoadSessionRequest,
  LoadSessionResponse,
  PromptRequest,
  PromptResponse,
  SessionUpdate,
  PromptPart,
} from "./client"
import { JsonRpcConnection, JsonRpcNotification } from "./connection"

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

describe("AcpClient", () => {
  let client: AcpClient
  let streams: ReturnType<typeof createMockStreams>
  let connection: JsonRpcConnection

  beforeEach(() => {
    streams = createMockStreams()
    connection = new JsonRpcConnection(streams.stdin, streams.stdout)
  })

  afterEach(async () => {
    if (client) {
      await client.dispose()
    }
    connection.dispose()
  })

  describe("initialization", () => {
    it("AcpClient can initialize with opencode", async () => {
      const config: AcpClientConfig = {
        connection,
        clientInfo: { name: "test-client", version: "1.0.0" },
        clientCapabilities: {},
      }

      client = new AcpClient(config)
      assert.strictEqual(client.getState(), AcpClientState.CREATED)

      // Mock initialize response
      const initPromise = client.initialize()

      // Wait for request to be sent
      await new Promise((r) => setTimeout(r, 10))

      const request = JSON.parse(streams.stdin.written[0])
      assert.strictEqual(request.method, "initialize")
      assert.strictEqual(request.params.clientInfo.name, "test-client")

      // Send response
      const response: InitializeResponse = {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
          promptCapabilities: { embeddedContext: true, image: true },
        },
        agentInfo: { name: "opencode", version: "1.0.0" },
      }

      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result: response,
        }) + "\n",
      )

      const result = await initPromise
      assert.deepStrictEqual(result, response)
      assert.strictEqual(client.getState(), AcpClientState.INITIALIZED)
    })

    it("throws if connection is not provided", () => {
      assert.throws(() => {
        new AcpClient({} as AcpClientConfig)
      }, /connection is required/)
    })

    it("throws if initialize is called twice", async () => {
      const config: AcpClientConfig = {
        connection,
        clientInfo: { name: "test", version: "1.0.0" },
      }

      client = new AcpClient(config)

      // First initialize
      const initPromise = client.initialize()
      await new Promise((r) => setTimeout(r, 10))
      const request = JSON.parse(streams.stdin.written[0])
      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result: { protocolVersion: 1, agentCapabilities: {}, agentInfo: {} },
        }) + "\n",
      )
      await initPromise

      // Second initialize should throw
      await assert.rejects(client.initialize(), /already initialized/)
    })
  })

  describe("session management", () => {
    beforeEach(async () => {
      const config: AcpClientConfig = {
        connection,
        clientInfo: { name: "test", version: "1.0.0" },
      }
      client = new AcpClient(config)

      // Initialize client first
      const initPromise = client.initialize()
      await new Promise((r) => setTimeout(r, 10))
      const request = JSON.parse(streams.stdin.written[streams.stdin.written.length - 1])
      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result: { protocolVersion: 1, agentCapabilities: {}, agentInfo: {} },
        }) + "\n",
      )
      await initPromise
    })

    it("AcpClient can create new session", async () => {
      const request: NewSessionRequest = {
        cwd: "/tmp/test",
      }

      const sessionPromise = client.createSession(request)
      await new Promise((r) => setTimeout(r, 10))

      const req = JSON.parse(streams.stdin.written[streams.stdin.written.length - 1])
      assert.strictEqual(req.method, "session/new")
      assert.strictEqual(req.params.cwd, "/tmp/test")

      const response: NewSessionResponse = {
        sessionId: "ses_123",
      }

      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: req.id,
          result: response,
        }) + "\n",
      )

      const result = await sessionPromise
      assert.strictEqual(result.sessionId, "ses_123")
    })

    it("AcpClient can load existing session", async () => {
      const request: LoadSessionRequest = {
        sessionId: "ses_456",
        cwd: "/tmp/test",
      }

      const sessionPromise = client.loadSession(request)
      await new Promise((r) => setTimeout(r, 10))

      const req = JSON.parse(streams.stdin.written[streams.stdin.written.length - 1])
      assert.strictEqual(req.method, "session/load")
      assert.strictEqual(req.params.sessionId, "ses_456")

      const response: LoadSessionResponse = {
        sessionId: "ses_456",
      }

      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: req.id,
          result: response,
        }) + "\n",
      )

      const result = await sessionPromise
      assert.strictEqual(result.sessionId, "ses_456")
    })

    it("throws if not initialized", async () => {
      const uninitializedClient = new AcpClient({
        connection,
        clientInfo: { name: "test", version: "1.0.0" },
      })

      await assert.rejects(uninitializedClient.createSession({ cwd: "/tmp" }), /not initialized/)
    })
  })

  describe("prompt and streaming", () => {
    beforeEach(async () => {
      const config: AcpClientConfig = {
        connection,
        clientInfo: { name: "test", version: "1.0.0" },
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
          result: { protocolVersion: 1, agentCapabilities: {}, agentInfo: {} },
        }) + "\n",
      )
      await initPromise
    })

    it("AcpClient can send prompt and receive streaming updates", async () => {
      const updates: SessionUpdate[] = []

      client.onSessionUpdate((sessionId, update) => {
        updates.push(update)
      })

      const promptRequest: PromptRequest = {
        sessionId: "ses_123",
        prompt: [{ type: "text", text: "Hello" }],
      }

      const promptPromise = client.sendPrompt(promptRequest)
      await new Promise((r) => setTimeout(r, 10))

      const req = JSON.parse(streams.stdin.written[streams.stdin.written.length - 1])
      assert.strictEqual(req.method, "session/prompt")

      // Send streaming updates
      const update1: SessionUpdate = {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Hello" },
      }

      const update2: SessionUpdate = {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: " World" },
      }

      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "session/update",
          params: { sessionId: "ses_123", update: update1 },
        }) + "\n",
      )

      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "session/update",
          params: { sessionId: "ses_123", update: update2 },
        }) + "\n",
      )

      await new Promise((r) => setTimeout(r, 10))

      // Send final response
      const response: PromptResponse = {
        stopReason: "end_turn",
      }

      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: req.id,
          result: response,
        }) + "\n",
      )

      const result = await promptPromise
      assert.strictEqual(result.stopReason, "end_turn")

      assert.strictEqual(updates.length, 2)
      assert.strictEqual(updates[0].sessionUpdate, "agent_message_chunk")
      assert.strictEqual(
        (updates[0] as Extract<SessionUpdate, { sessionUpdate: "agent_message_chunk" }>).content.text,
        "Hello",
      )
      assert.strictEqual(
        (updates[1] as Extract<SessionUpdate, { sessionUpdate: "agent_message_chunk" }>).content.text,
        " World",
      )
    })

    it("handles different prompt part types", async () => {
      const promptParts: PromptPart[] = [
        { type: "text", text: "Hello" },
        {
          type: "image",
          mimeType: "image/png",
          data: "base64data",
        },
      ]

      const promptRequest: PromptRequest = {
        sessionId: "ses_123",
        prompt: promptParts,
      }

      const promptPromise = client.sendPrompt(promptRequest)
      await new Promise((r) => setTimeout(r, 10))

      const req = JSON.parse(streams.stdin.written[streams.stdin.written.length - 1])
      assert.strictEqual(req.params.prompt.length, 2)
      assert.strictEqual(req.params.prompt[0].type, "text")
      assert.strictEqual(req.params.prompt[1].type, "image")

      // Complete the request
      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: req.id,
          result: { stopReason: "end_turn" },
        }) + "\n",
      )

      await promptPromise
    })
  })

  describe("cancellation", () => {
    beforeEach(async () => {
      const config: AcpClientConfig = {
        connection,
        clientInfo: { name: "test", version: "1.0.0" },
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
          result: { protocolVersion: 1, agentCapabilities: {}, agentInfo: {} },
        }) + "\n",
      )
      await initPromise
    })

    it("AcpClient can cancel in-flight request", async () => {
      const promptRequest: PromptRequest = {
        sessionId: "ses_123",
        prompt: [{ type: "text", text: "Hello" }],
      }

      const promptPromise = client.sendPrompt(promptRequest)
      await new Promise((r) => setTimeout(r, 10))

      // Send cancel notification
      await client.cancel({ sessionId: "ses_123" })

      await new Promise((r) => setTimeout(r, 10))

      // Check that cancel was sent
      const cancelReq = streams.stdin.written.find((w) => {
        try {
          const parsed = JSON.parse(w)
          return parsed.method === "session/cancel"
        } catch {
          return false
        }
      })

      assert.ok(cancelReq, "Cancel notification should be sent")
      const parsed = JSON.parse(cancelReq)
      assert.strictEqual(parsed.params.sessionId, "ses_123")
      assert.strictEqual(parsed.id, undefined, "Notifications should not have id")
    })
  })

  describe("error handling", () => {
    beforeEach(async () => {
      const config: AcpClientConfig = {
        connection,
        clientInfo: { name: "test", version: "1.0.0" },
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
          result: { protocolVersion: 1, agentCapabilities: {}, agentInfo: {} },
        }) + "\n",
      )
      await initPromise
    })

    it("AcpClient handles protocol errors gracefully", async () => {
      const sessionPromise = client.createSession({ cwd: "/tmp" })
      await new Promise((r) => setTimeout(r, 10))

      const req = JSON.parse(streams.stdin.written[streams.stdin.written.length - 1])

      // Send error response with ACP error code
      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: req.id,
          error: {
            code: AcpErrorCode.InvalidParams,
            message: "Invalid working directory",
          },
        }) + "\n",
      )

      try {
        await sessionPromise
        assert.fail("Should have thrown")
      } catch (error) {
        assert.ok(error instanceof AcpError)
        assert.strictEqual((error as AcpError).code, AcpErrorCode.InvalidParams)
        assert.ok((error as AcpError).message.includes("Invalid working directory"))
      }
    })

    it("handles authentication required error", async () => {
      const sessionPromise = client.createSession({ cwd: "/tmp" })
      await new Promise((r) => setTimeout(r, 10))

      const req = JSON.parse(streams.stdin.written[streams.stdin.written.length - 1])

      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: req.id,
          error: {
            code: AcpErrorCode.AuthRequired,
            message: "Authentication required",
          },
        }) + "\n",
      )

      try {
        await sessionPromise
        assert.fail("Should have thrown")
      } catch (error) {
        assert.ok(error instanceof AcpError)
        assert.strictEqual((error as AcpError).code, AcpErrorCode.AuthRequired)
      }
    })

    it("handles session not found error", async () => {
      const loadPromise = client.loadSession({ sessionId: "invalid", cwd: "/tmp" })
      await new Promise((r) => setTimeout(r, 10))

      const req = JSON.parse(streams.stdin.written[streams.stdin.written.length - 1])

      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: req.id,
          error: {
            code: AcpErrorCode.SessionNotFound,
            message: "Session not found",
          },
        }) + "\n",
      )

      try {
        await loadPromise
        assert.fail("Should have thrown")
      } catch (error) {
        assert.ok(error instanceof AcpError)
        assert.strictEqual((error as AcpError).code, AcpErrorCode.SessionNotFound)
      }
    })

    it("handles unknown errors", async () => {
      const sessionPromise = client.createSession({ cwd: "/tmp" })
      await new Promise((r) => setTimeout(r, 10))

      const req = JSON.parse(streams.stdin.written[streams.stdin.written.length - 1])

      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          id: req.id,
          error: {
            code: -32000,
            message: "Unknown error",
          },
        }) + "\n",
      )

      try {
        await sessionPromise
        assert.fail("Should have thrown")
      } catch (error) {
        assert.ok(error instanceof AcpError)
        assert.strictEqual((error as AcpError).code, -32000)
      }
    })
  })

  describe("events", () => {
    beforeEach(async () => {
      const config: AcpClientConfig = {
        connection,
        clientInfo: { name: "test", version: "1.0.0" },
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
          result: { protocolVersion: 1, agentCapabilities: {}, agentInfo: {} },
        }) + "\n",
      )
      await initPromise
    })

    it("AcpClient emits events for notifications", async () => {
      const notifications: Array<{ sessionId: string; update: SessionUpdate }> = []

      client.onSessionUpdate((sessionId, update) => {
        notifications.push({ sessionId, update })
      })

      // Simulate notification
      const update: SessionUpdate = {
        sessionUpdate: "usage_update",
        used: 100,
        size: 1000,
      }

      streams.stdout.pushData(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "session/update",
          params: { sessionId: "ses_123", update },
        }) + "\n",
      )

      await new Promise((r) => setTimeout(r, 10))

      assert.strictEqual(notifications.length, 1)
      assert.strictEqual(notifications[0].sessionId, "ses_123")
      assert.strictEqual(notifications[0].update.sessionUpdate, "usage_update")
    })

    it("emits error events", async () => {
      const errors: Error[] = []

      client.onError((error) => {
        errors.push(error)
      })

      // Send invalid JSON to trigger error
      streams.stdout.pushData("invalid json\n")

      await new Promise((r) => setTimeout(r, 10))

      assert.strictEqual(errors.length, 1)
      assert.ok(errors[0].message.includes("JSON"))
    })

    it("emits state change events", async () => {
      const stateChanges: AcpClientState[] = []

      client.onStateChange((state) => {
        stateChanges.push(state)
      })

      // Already initialized in beforeEach
      assert.ok(stateChanges.includes(AcpClientState.INITIALIZED))
    })
  })

  describe("dispose", () => {
    it("cleans up resources on dispose", async () => {
      const config: AcpClientConfig = {
        connection,
        clientInfo: { name: "test", version: "1.0.0" },
      }
      client = new AcpClient(config)

      await client.dispose()

      assert.strictEqual(client.getState(), AcpClientState.DISPOSED)
    })

    it("can be disposed multiple times", async () => {
      const config: AcpClientConfig = {
        connection,
        clientInfo: { name: "test", version: "1.0.0" },
      }
      client = new AcpClient(config)

      await client.dispose()
      await client.dispose() // Should not throw

      assert.strictEqual(client.getState(), AcpClientState.DISPOSED)
    })

    it("rejects pending operations on dispose", async () => {
      const config: AcpClientConfig = {
        connection,
        clientInfo: { name: "test", version: "1.0.0" },
      }
      client = new AcpClient(config)

      // Start an operation that won't complete
      const initPromise = client.initialize()

      // Dispose immediately
      await client.dispose()

      await assert.rejects(initPromise, /disposed/)
    })
  })
})
